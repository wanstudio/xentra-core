const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../server/app');
const http = require('http');

let server;
let baseUrl;
const brandId = 'brand_test_workforce';
const orgId = 'org_test_workforce';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'test.mybangjo.com',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Workforce Management', () => {
  let db;
  let ownerToken;
  let managerToken;
  let cashierToken;
  let userIds = {};

  before(async () => {
    // Start server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Get db reference
    db = require('../server/database/db');

    // Create test brand and org
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Test Org', 'test-org');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(brandId, orgId, 'Test Brand', 'test-brand', 'test.mybangjo.com');

    // Create test branches
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run('branch_a', brandId, 'Branch A', 'branch-a', 'Jl. Test No. 1', -7.25, 112.75);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)').run('branch_b', brandId, 'Branch B', 'branch-b', 'Jl. Test No. 2', -7.26, 112.76);

    // Seed admin user for the test brand (Host: test.mybangjo.com resolves to brand_test_workforce)
    // Note: users.username is globally UNIQUE, so we must use a unique username for this brand
    const bcrypt = require('bcryptjs');
    const adminHash = bcrypt.hashSync('bangjo123', 12);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `).run('usr_test_owner', brandId, orgId, 'admin_test', 'admin@test.com', adminHash, 'Test Owner', 'owner');

    // Login as owner to get token
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin_test',
      password: 'bangjo123'
    });
    ownerToken = loginRes.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  // ==================== AUTHENTICATION ====================

  describe('Authentication', () => {
    it('WF-AUTH-01: Valid credentials return token', async () => {
      const res = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'admin_test',
        password: 'bangjo123'
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.ok(res.data.token);
    });

    it('WF-AUTH-02: Invalid password rejected', async () => {
      const res = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'admin_test',
        password: 'wrongpassword'
      });
      assert.equal(res.status, 401);
    });

    it('WF-AUTH-03: Disabled user cannot authenticate', async () => {
      // Create a user
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'disabled_user',
        password: 'Test1234!',
        full_name: 'Disabled User',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });
      
      if (createRes.status === 201) {
        const userId = createRes.data.user.id;
        
        // Disable the user
        await request('POST', `/api/v1/admin/users/${userId}/disable`, {}, {
          'Authorization': `Bearer ${ownerToken}`
        });

        // Try to login
        const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'disabled_user',
          password: 'Test1234!'
        });
        assert.equal(loginRes.status, 403);
      }
    });

    it('WF-AUTH-04: Account lockout after 5 failed attempts', async () => {
      // Create a user for lockout test
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'lockout_test',
        password: 'Test1234!',
        full_name: 'Lockout Test',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });
      
      if (createRes.status === 201) {
        // Try 5 wrong passwords
        for (let i = 0; i < 5; i++) {
          await request('POST', '/api/v1/auth/merchant/login', {
            username: 'lockout_test',
            password: 'wrongpassword'
          });
        }

        // 6th attempt should be blocked — either by rate limiter (429) or account lockout (423)
        const res = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'lockout_test',
          password: 'Test1234!'
        });
        assert.ok(res.status === 423 || res.status === 429, `Expected 423 or 429, got ${res.status}`);
      }
    });
  });

  // ==================== USER CREATION ====================

  describe('User Creation', () => {
    it('WF-CREATE-01: Owner can create Manager', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'test_manager',
        password: 'Test1234!',
        full_name: 'Test Manager',
        role: 'brand_manager'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 201);
      assert.equal(res.data.user.role, 'brand_manager');
      userIds.manager = res.data.user.id;
    });

    it('WF-CREATE-02: Owner can create Cashier', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'test_cashier',
        password: 'Test1234!',
        full_name: 'Test Cashier',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 201);
      assert.equal(res.data.user.role, 'cashier');
      userIds.cashier = res.data.user.id;
    });

    it('WF-CREATE-03: Manager can create Cashier', async () => {
      // Login as manager first
      // Need to create manager with known password
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_manager',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('POST', '/api/v1/admin/users', {
          username: 'manager_cashier',
          password: 'Test1234!',
          full_name: 'Manager Cashier',
          role: 'cashier',
          branch_id: 'branch_a'
        }, { 'Authorization': `Bearer ${loginRes.data.token}` });

        assert.equal(res.status, 201);
        assert.equal(res.data.user.role, 'cashier');
      }
    });

    it('WF-CREATE-04: Manager CANNOT create Manager', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_manager',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('POST', '/api/v1/admin/users', {
          username: 'illegal_manager',
          password: 'Test1234!',
          full_name: 'Illegal Manager',
          role: 'brand_manager'
        }, { 'Authorization': `Bearer ${loginRes.data.token}` });

        assert.equal(res.status, 403);
      }
    });

    it('WF-CREATE-05: Cashier CANNOT create any user', async () => {
      // Login as cashier
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_cashier',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('POST', '/api/v1/admin/users', {
          username: 'illegal_user',
          password: 'Test1234!',
          full_name: 'Illegal User',
          role: 'cashier'
        }, { 'Authorization': `Bearer ${loginRes.data.token}` });

        assert.equal(res.status, 403);
      }
    });

    it('WF-CREATE-06: Duplicate username rejected', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'test_manager', // Already exists
        password: 'Test1234!',
        full_name: 'Duplicate Manager',
        role: 'brand_manager'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 409);
    });

    it('WF-CREATE-07: Invalid role rejected', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'invalid_role_user',
        password: 'Test1234!',
        full_name: 'Invalid Role',
        role: 'superadmin'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 403);
    });
  });

  // ==================== USER READ/LIST ====================

  describe('User Read/List', () => {
    it('WF-READ-01: Owner can list users', async () => {
      const res = await request('GET', '/api/v1/admin/users', null, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.users));
    });

    it('WF-READ-02: Manager can list users', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_manager',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('GET', '/api/v1/admin/users', null, {
          'Authorization': `Bearer ${loginRes.data.token}`
        });

        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.users));
      }
    });

    it('WF-READ-03: Cashier CANNOT list users', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_cashier',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('GET', '/api/v1/admin/users', null, {
          'Authorization': `Bearer ${loginRes.data.token}`
        });

        assert.equal(res.status, 403);
      }
    });
  });

  // ==================== DISABLE/ENABLE ====================

  describe('Disable/Enable', () => {
    it('WF-DISABLE-01: Owner can disable Cashier', async () => {
      const res = await request('POST', `/api/v1/admin/users/${userIds.cashier}/disable`, {}, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.user.status, 'disabled');
    });

    it('WF-DISABLE-02: Disabled user cannot login', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_cashier',
        password: 'Test1234!'
      });

      assert.equal(loginRes.status, 403);
    });

    it('WF-DISABLE-03: Owner can enable Cashier', async () => {
      const res = await request('POST', `/api/v1/admin/users/${userIds.cashier}/enable`, {}, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.user.status, 'active');
    });

    it('WF-DISABLE-04: Enabled user can login', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_cashier',
        password: 'Test1234!'
      });

      assert.equal(loginRes.status, 200);
    });

    it('WF-DISABLE-05: Manager CANNOT disable Manager', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_manager',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('POST', `/api/v1/admin/users/${userIds.manager}/disable`, {}, {
          'Authorization': `Bearer ${loginRes.data.token}`
        });

        assert.equal(res.status, 403);
      }
    });

    it('WF-DISABLE-06: Last Owner cannot be disabled', async () => {
      // Get owner user ID
      const listRes = await request('GET', '/api/v1/admin/users', null, {
        'Authorization': `Bearer ${ownerToken}`
      });
      
      const owner = listRes.data.users.find(u => u.role === 'owner');
      if (owner) {
        const res = await request('POST', `/api/v1/admin/users/${owner.id}/disable`, {}, {
          'Authorization': `Bearer ${ownerToken}`
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.error, 'Cannot disable the last Owner account.');
      }
    });
  });

  // ==================== PASSWORD MANAGEMENT ====================

  describe('Password Management', () => {
    it('WF-PWD-01: Self password change with correct current password', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', {
        current_password: 'bangjo123',
        new_password: 'NewPass123!',
        confirm_password: 'NewPass123!'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 200);
      
      // Login with new password
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'admin_test',
        password: 'NewPass123!'
      });
      assert.equal(loginRes.status, 200);
      ownerToken = loginRes.data.token; // Update token

      // Change back
      await request('POST', '/api/v1/auth/change-password', {
        current_password: 'NewPass123!',
        new_password: 'bangjo123',
        confirm_password: 'bangjo123'
      }, { 'Authorization': `Bearer ${ownerToken}` });
      
      // Login again with original password
      const loginRes2 = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'admin_test',
        password: 'bangjo123'
      });
      ownerToken = loginRes2.data.token;
    });

    it('WF-PWD-02: Self password change with wrong current password rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', {
        current_password: 'wrongpassword',
        new_password: 'NewPass123!',
        confirm_password: 'NewPass123!'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 401);
    });

    it('WF-PWD-03: Password mismatch rejected', async () => {
      const res = await request('POST', '/api/v1/auth/change-password', {
        current_password: 'bangjo123',
        new_password: 'NewPass123!',
        confirm_password: 'DifferentPass123!'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 400);
    });

    it('WF-PWD-04: Admin reset password generates token', async () => {
      const res = await request('POST', `/api/v1/admin/users/${userIds.cashier}/reset-password`, {}, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
      assert.ok(res.data.reset_token);
      assert.ok(res.data.expires_at);
    });

    it('WF-PWD-05: Complete password reset with token', async () => {
      // Get reset token
      const resetRes = await request('POST', `/api/v1/admin/users/${userIds.cashier}/reset-password`, {}, {
        'Authorization': `Bearer ${ownerToken}`
      });

      if (resetRes.status === 200) {
        const res = await request('POST', '/api/v1/auth/reset-password', {
          token: resetRes.data.reset_token,
          new_password: 'ResetPass123!'
        });

        assert.equal(res.status, 200);

        // Login with new password
        const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'test_cashier',
          password: 'ResetPass123!'
        });
        assert.equal(loginRes.status, 200);

        // Change back
        const token = loginRes.data.token;
        await request('POST', '/api/v1/auth/change-password', {
          current_password: 'ResetPass123!',
          new_password: 'Test1234!',
          confirm_password: 'Test1234!'
        }, { 'Authorization': `Bearer ${token}` });
      }
    });

    it('WF-PWD-06: Reset token single-use (replay fails)', async () => {
      const resetRes = await request('POST', `/api/v1/admin/users/${userIds.cashier}/reset-password`, {}, {
        'Authorization': `Bearer ${ownerToken}`
      });

      if (resetRes.status === 200) {
        // First use
        const res1 = await request('POST', '/api/v1/auth/reset-password', {
          token: resetRes.data.reset_token,
          new_password: 'TempPass123!'
        });
        assert.equal(res1.status, 200);

        // Replay (should fail)
        const res2 = await request('POST', '/api/v1/auth/reset-password', {
          token: resetRes.data.reset_token,
          new_password: 'AnotherPass123!'
        });
        assert.equal(res2.status, 400);
      }
    });
  });

  // ==================== ROLE/SCOPE CHANGES ====================

  describe('Role/Scope Changes', () => {
    it('WF-ROLE-01: Owner can change user role', async () => {
      // Create a temporary user
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'role_test_user',
        password: 'Test1234!',
        full_name: 'Role Test',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      if (createRes.status === 201) {
        const userId = createRes.data.user.id;
        
        // Change role
        const res = await request('POST', `/api/v1/admin/users/${userId}/role`, {
          role: 'kitchen'
        }, { 'Authorization': `Bearer ${ownerToken}` });

        assert.equal(res.status, 200);
        assert.equal(res.data.user.role, 'kitchen');
      }
    });

    it('WF-ROLE-02: Manager CANNOT change roles', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_manager',
        password: 'Test1234!'
      });
      
      if (loginRes.status === 200) {
        const res = await request('POST', `/api/v1/admin/users/${userIds.cashier}/role`, {
          role: 'kitchen'
        }, { 'Authorization': `Bearer ${loginRes.data.token}` });

        assert.equal(res.status, 403);
      }
    });

    it('WF-ROLE-03: Last Owner cannot be demoted', async () => {
      const listRes = await request('GET', '/api/v1/admin/users', null, {
        'Authorization': `Bearer ${ownerToken}`
      });
      
      const owner = listRes.data.users.find(u => u.role === 'owner');
      if (owner) {
        const res = await request('POST', `/api/v1/admin/users/${owner.id}/role`, {
          role: 'brand_manager'
        }, { 'Authorization': `Bearer ${ownerToken}` });

        assert.equal(res.status, 400);
      }
    });
  });

  // ==================== SESSION SECURITY ====================

  describe('Session Security', () => {
    it('WF-SESSION-01: Logout invalidates session', async () => {
      // Create a user and login
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'logout_test',
        password: 'Test1234!',
        full_name: 'Logout Test',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      if (createRes.status === 201) {
        const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'logout_test',
          password: 'Test1234!'
        });

        if (loginRes.status === 200) {
          const token = loginRes.data.token;
          
          // Logout
          const logoutRes = await request('POST', '/api/v1/auth/logout', {}, {
            'Authorization': `Bearer ${token}`
          });
          assert.equal(logoutRes.status, 200);

          // Try to use old token
          const meRes = await request('GET', '/api/v1/auth/merchant/me', null, {
            'Authorization': `Bearer ${token}`
          });
          assert.equal(meRes.status, 401);
        }
      }
    });

    it('WF-SESSION-02: Disable revokes sessions', async () => {
      // Create user and login
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'revoke_test',
        password: 'Test1234!',
        full_name: 'Revoke Test',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      if (createRes.status === 201) {
        const userId = createRes.data.user.id;
        const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'revoke_test',
          password: 'Test1234!'
        });

        if (loginRes.status === 200) {
          const token = loginRes.data.token;
          
          // Verify session works
          const meRes1 = await request('GET', '/api/v1/auth/merchant/me', null, {
            'Authorization': `Bearer ${token}`
          });
          assert.equal(meRes1.status, 200);

          // Disable user
          await request('POST', `/api/v1/admin/users/${userId}/disable`, {}, {
            'Authorization': `Bearer ${ownerToken}`
          });

          // Session should be revoked
          const meRes2 = await request('GET', '/api/v1/auth/merchant/me', null, {
            'Authorization': `Bearer ${token}`
          });
          assert.equal(meRes2.status, 401);
        }
      }
    });
  });

  // ==================== AUDIT LOGGING ====================

  describe('Audit Logging', () => {
    it('WF-AUDIT-01: Security events are logged', async () => {
      const res = await request('GET', '/api/v1/admin/security-audit', null, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.logs));
    });

    it('WF-AUDIT-02: Login attempts are logged', async () => {
      const res = await request('GET', '/api/v1/admin/security-audit?action=LOGIN_SUCCESS', null, {
        'Authorization': `Bearer ${ownerToken}`
      });

      assert.equal(res.status, 200);
    });
  });

  // ==================== IDOR PROTECTION ====================

  describe('IDOR Protection', () => {
    it('WF-IDOR-01: Branch Manager cannot access users from other branches', async () => {
      // Create cashier in branch_b
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'branch_b_cashier',
        password: 'Test1234!',
        full_name: 'Branch B Cashier',
        role: 'cashier',
        branch_id: 'branch_b'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      if (createRes.status === 201) {
        // Create a branch_manager for branch_a
        const bmCreateRes = await request('POST', '/api/v1/admin/users', {
          username: 'branch_a_manager',
          password: 'Test1234!',
          full_name: 'Branch A Manager',
          role: 'branch_manager',
          branch_id: 'branch_a'
        }, { 'Authorization': `Bearer ${ownerToken}` });

        if (bmCreateRes.status === 201) {
          // Login as branch_manager
          const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
            username: 'branch_a_manager',
            password: 'Test1234!'
          });

          if (loginRes.status === 200) {
            // Try to access branch_b cashier (should be denied)
            const res = await request('GET', `/api/v1/admin/users/${createRes.data.user.id}`, null, {
              'Authorization': `Bearer ${loginRes.data.token}`
            });

            assert.equal(res.status, 403);
          }
        }
      }
    });
  });

  // ==================== ADVERSARIAL VERIFICATION ====================

  describe('Adversarial Verification', () => {
    it('WF-ADV-01: Cashier cannot self-promote via payload', async () => {
      const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
        username: 'test_cashier',
        password: 'Test1234!'
      });

      if (loginRes.status === 200) {
        // Try to change own role
        const res = await request('POST', `/api/v1/admin/users/${userIds.cashier}/role`, {
          role: 'owner'
        }, { 'Authorization': `Bearer ${loginRes.data.token}` });

        assert.equal(res.status, 403);
      }
    });

    it('WF-ADV-02: Arbitrary role values are rejected', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'adv_test',
        password: 'Test1234!',
        full_name: 'Adv Test',
        role: 'superadmin'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 403);
    });

    it('WF-ADV-03: Client-supplied branch_id is validated', async () => {
      const res = await request('POST', '/api/v1/admin/users', {
        username: 'adv_branch_test',
        password: 'Test1234!',
        full_name: 'Adv Branch Test',
        role: 'cashier',
        branch_id: 'nonexistent_branch'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      assert.equal(res.status, 400);
    });

    it('WF-ADV-04: Stale session after role change is rejected', async () => {
      // Create user
      const createRes = await request('POST', '/api/v1/admin/users', {
        username: 'stale_test',
        password: 'Test1234!',
        full_name: 'Stale Test',
        role: 'cashier',
        branch_id: 'branch_a'
      }, { 'Authorization': `Bearer ${ownerToken}` });

      if (createRes.status === 201) {
        const userId = createRes.data.user.id;
        const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
          username: 'stale_test',
          password: 'Test1234!'
        });

        if (loginRes.status === 200) {
          const token = loginRes.data.token;
          
          // Demote to kitchen
          await request('POST', `/api/v1/admin/users/${userId}/role`, {
            role: 'kitchen'
          }, { 'Authorization': `Bearer ${ownerToken}` });

          // Try to access admin endpoint with stale session (should still work for basic auth)
          // but role ceiling should be enforced
          const res = await request('POST', '/api/v1/admin/users', {
            username: 'should_fail',
            password: 'Test1234!',
            full_name: 'Should Fail',
            role: 'cashier'
          }, { 'Authorization': `Bearer ${token}` });

          // Session revoked (401) or role ceiling enforced (403) — both are secure
          assert.ok(res.status === 401 || res.status === 403, `Expected 401 or 403, got ${res.status}`);
        }
      }
    });
  });
});
