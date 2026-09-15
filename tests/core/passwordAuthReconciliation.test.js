'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = require('../../server/database/db');
const { WorkforceService, RegistrationService, AuthProviderService } = require('../../core/identity');

describe('Phase 5: Password / Auth Credential Schema Reconciliation', () => {
  const brandId = 'brand_bangjo';
  const orgId = 'org_xentra_holding';

  beforeEach(() => {
    // Clean up test users
    db.prepare("DELETE FROM users WHERE id LIKE 'usr_p5_%'").run();
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id LIKE 'usr_p5_%'").run();
    db.prepare("DELETE FROM user_auth_providers WHERE user_id LIKE 'usr_p5_%'").run();
  });

  // P5-01: Schema accepts NULL for password_hash
  test('P5-01: Schema allows inserting user with NULL password_hash', () => {
    const userId = 'usr_p5_null_pw_' + crypto.randomBytes(4).toString('hex');
    const username = 'usr_null_pw_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
        VALUES (?, ?, ?, ?, ?, NULL, 'No Password User', 'owner', 'active', NULL, datetime('now'))
      `).run(userId, brandId, orgId, username, email);
    });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    assert.ok(user, 'User must exist in database');
    assert.strictEqual(user.password_hash, null);
    assert.strictEqual(user.password_changed_at, null);
  });

  // P5-02: Password login for password_hash = NULL fails safely with INVALID_CREDENTIALS
  test('P5-02: Password login for user without password credential fails safely as INVALID_CREDENTIALS', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_auth_null_' + crypto.randomBytes(4).toString('hex');
    const username = 'auth_null_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Auth Null User', 'owner', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    // Attempting login with password should fail gracefully without throwing
    const result = wf.authenticate(username, 'someRandomPassword123!', brandId);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'INVALID_CREDENTIALS');

    // Verify failed login attempts are tracked
    const userAfter = db.prepare('SELECT failed_login_attempts FROM users WHERE id = ?').get(userId);
    assert.strictEqual(userAfter.failed_login_attempts, 1);
  });

  // P5-03: Repeated failed password logins for passwordless user lead to account lockout
  test('P5-03: Repeated failed logins for passwordless user trigger lockout', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_lockout_' + crypto.randomBytes(4).toString('hex');
    const username = 'lockout_null_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Lockout User', 'owner', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    for (let i = 0; i < 5; i++) {
      wf.authenticate(username, 'wrongPassword!', brandId);
    }

    const lockedResult = wf.authenticate(username, 'wrongPassword!', brandId);
    assert.strictEqual(lockedResult.success, false);
    assert.strictEqual(lockedResult.error, 'ACCOUNT_LOCKED');
  });

  // P5-04: Google onboarding creates user with password_hash = NULL
  test('P5-04: RegistrationService.registerBusinessWithGoogle creates user with NULL password_hash', () => {
    const regService = new RegistrationService();
    const testSub = 'google_sub_p5_' + crypto.randomBytes(6).toString('hex');
    const email = `google_p5_${crypto.randomBytes(4).toString('hex')}@xentra.cloud`;

    const result = regService.registerBusinessWithGoogle({
      googleSub: testSub,
      email,
      full_name: 'Google Registered Owner',
      business_name: 'P5 Test Resto'
    });

    assert.ok(result && result.user && result.user.id);
    const user = db.prepare('SELECT id, password_hash, password_changed_at FROM users WHERE id = ?').get(result.user.id);
    assert.ok(user);
    assert.strictEqual(user.password_hash, null, 'Google-registered user must have password_hash = NULL');
    assert.strictEqual(user.password_changed_at, null, 'password_changed_at must be NULL for initial Google user');
  });

  // P5-05: RegistrationService.registerIdentityWithGoogle creates user with password_hash = NULL
  test('P5-05: RegistrationService.registerIdentityWithGoogle creates user with NULL password_hash', () => {
    const regService = new RegistrationService();
    const testSub = 'google_sub_id_p5_' + crypto.randomBytes(6).toString('hex');
    const email = `google_id_p5_${crypto.randomBytes(4).toString('hex')}@xentra.cloud`;

    const result = regService.registerIdentityWithGoogle({
      googleSub: testSub,
      email,
      full_name: 'Google Identity Owner'
    });

    assert.ok(result && result.user && result.user.id);
    const user = db.prepare('SELECT id, password_hash, password_changed_at FROM users WHERE id = ?').get(result.user.id);
    assert.ok(user);
    assert.strictEqual(user.password_hash, null, 'Identity Google user must have password_hash = NULL');
    assert.strictEqual(user.password_changed_at, null);
  });

  // P5-06: selfChangePassword throws NO_PASSWORD_SET for passwordless user
  test('P5-06: selfChangePassword rejects passwordless account with NO_PASSWORD_SET', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_self_null_' + crypto.randomBytes(4).toString('hex');
    const username = 'self_null_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Self Change User', 'owner', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    assert.throws(() => {
      wf.selfChangePassword(userId, brandId, 'current123', 'newPassword123!', 'newPassword123!');
    }, (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'NO_PASSWORD_SET');
      return true;
    });
  });

  // P5-07: selfChangePassword succeeds when user has valid password
  test('P5-07: selfChangePassword succeeds when user has valid password', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_self_valid_' + crypto.randomBytes(4).toString('hex');
    const username = 'self_valid_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;
    const oldHash = wf.hashPassword('OldSecret123!');

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Self Change Valid', 'owner', 'active', datetime('now'), datetime('now'))
    `).run(userId, brandId, orgId, username, email, oldHash);

    const res = wf.selfChangePassword(userId, brandId, 'OldSecret123!', 'NewSecret456!', 'NewSecret456!');
    assert.strictEqual(res.success, true);

    const updated = db.prepare('SELECT password_hash, password_changed_at FROM users WHERE id = ?').get(userId);
    assert.ok(wf.verifyPassword('NewSecret456!', updated.password_hash));
    assert.ok(updated.password_changed_at != null);
  });

  // P5-08: Admin reset password + completePasswordReset establishes password for passwordless user
  test('P5-08: Password reset establishes password credential for previously passwordless user', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_reset_establish_' + crypto.randomBytes(4).toString('hex');
    const username = 'reset_est_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Reset Establish User', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    // Admin creates reset token
    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    assert.ok(reset.reset_token);

    // Complete password reset
    const complete = wf.completePasswordReset(reset.reset_token, 'BrandNewPassword123!');
    assert.strictEqual(complete.success, true);
    assert.strictEqual(complete.user_id, userId);

    // User now has password_hash and password_changed_at
    const userAfter = db.prepare('SELECT password_hash, password_changed_at FROM users WHERE id = ?').get(userId);
    assert.ok(userAfter.password_hash != null);
    assert.ok(userAfter.password_changed_at != null);
    assert.ok(wf.verifyPassword('BrandNewPassword123!', userAfter.password_hash));

    // Can now authenticate with newly established password
    const authResult = wf.authenticate(username, 'BrandNewPassword123!', brandId);
    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.user.id, userId);
  });

  // P5-09: completePasswordReset invalidates sessions
  test('P5-09: completePasswordReset invokes session invalidation', () => {
    const wf = new WorkforceService();
    let revokedUserId = null;
    global.TokenSessionStore = {
      revokeUserSessions: (id) => {
        revokedUserId = id;
      }
    };

    const userId = 'usr_p5_sess_inv_' + crypto.randomBytes(4).toString('hex');
    const username = 'sess_inv_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Session Invalidation User', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    wf.completePasswordReset(reset.reset_token, 'FreshPassword123!');

    assert.strictEqual(revokedUserId, userId, 'User sessions must be revoked upon password reset');
  });

  // P5-10: AuthProviderService unlinkProvider preserves passwordless guard
  test('P5-10: Unlinking only auth provider from passwordless user is rejected', () => {
    const authProviderService = new AuthProviderService();
    const userId = 'usr_p5_unlink_' + crypto.randomBytes(4).toString('hex');
    const username = 'unlink_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Unlink Test User', 'owner', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    authProviderService.linkProvider({
      userId,
      provider: 'google',
      providerUserId: 'google_sub_unlink_1'
    });

    // Should fail because user has no password_hash and no other provider
    assert.throws(() => {
      authProviderService.unlinkProvider(userId, 'google');
    }, (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'CANNOT_UNLINK_ONLY_AUTH_METHOD');
      return true;
    });

    // Add password hash, then unlink should succeed
    const wf = new WorkforceService();
    const hash = wf.hashPassword('SomePass123!');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);

    const unlinkRes = authProviderService.unlinkProvider(userId, 'google');
    assert.strictEqual(unlinkRes.success, true);
  });

  // P5-11: Password login rejects disabled account even if passwordless
  test('P5-11: Disabled passwordless account rejects with ACCOUNT_DISABLED before credential check', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_disabled_' + crypto.randomBytes(4).toString('hex');
    const username = 'disabled_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Disabled User', 'owner', 'disabled', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const res = wf.authenticate(username, 'anyPassword', brandId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'ACCOUNT_DISABLED');
  });

  // P5-12: Password login rejects platform_owner via merchant authenticate
  test('P5-12: Platform owner is rejected with INVALID_CREDENTIALS through merchant auth', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_po_' + crypto.randomBytes(4).toString('hex');
    const username = 'po_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Platform Owner User', 'platform_owner', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const res = wf.authenticate(username, 'anyPassword', brandId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'INVALID_CREDENTIALS');
  });

  // P5-13: Password reset tokens have single-use enforcement
  test('P5-13: Reset token cannot be reused', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_singleuse_' + crypto.randomBytes(4).toString('hex');
    const username = 'singleuse_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Single Use User', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    wf.completePasswordReset(reset.reset_token, 'PassNumberOne123!');

    assert.throws(() => {
      wf.completePasswordReset(reset.reset_token, 'PassNumberTwo123!');
    }, (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'INVALID_TOKEN');
      return true;
    });
  });

  // P5-14: Password reset rejects password shorter than 8 characters
  test('P5-14: completePasswordReset enforces min length 8 characters', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_short_' + crypto.randomBytes(4).toString('hex');
    const username = 'short_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Short PW User', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });

    assert.throws(() => {
      wf.completePasswordReset(reset.reset_token, 'short');
    }, (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'PASSWORD_TOO_SHORT');
      return true;
    });
  });

  // P5-15: verifyPassword returns false for null/empty password or hash
  test('P5-15: verifyPassword returns false for falsy values without throwing', () => {
    const wf = new WorkforceService();
    assert.strictEqual(wf.verifyPassword('', 'somehash'), false);
    assert.strictEqual(wf.verifyPassword('password', ''), false);
    assert.strictEqual(wf.verifyPassword(null, 'somehash'), false);
    assert.strictEqual(wf.verifyPassword('password', null), false);
    assert.strictEqual(wf.verifyPassword(undefined, undefined), false);
  });

  // ==================== FINAL HARDENING: ATOMIC PASSWORD RESET ====================

  // P5-HARDEN-01: Successful password reset consumes token and changes password atomically
  test('P5-HARDEN-01: Successful password reset consumes token and changes password atomically', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_hrd_01_' + crypto.randomBytes(4).toString('hex');
    const username = 'hrd_01_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Harden User 1', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    const result = wf.completePasswordReset(reset.reset_token, 'AtomicPassword123!');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user_id, userId);

    // Verify token is marked used
    const tokenHash = crypto.createHash('sha256').update(reset.reset_token).digest('hex');
    const tokenRecord = db.prepare('SELECT used FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);
    assert.strictEqual(tokenRecord.used, 1);

    // Verify password is updated
    const user = db.prepare('SELECT password_hash, password_changed_at FROM users WHERE id = ?').get(userId);
    assert.ok(user.password_hash != null);
    assert.ok(user.password_changed_at != null);
    assert.ok(wf.verifyPassword('AtomicPassword123!', user.password_hash));
  });

  // P5-HARDEN-02: If password UPDATE fails, transaction rolls back, token remains unused, password unchanged, no sessions invalidated
  test('P5-HARDEN-02: If password UPDATE fails, token remains unused and sessions are not invalidated', () => {
    let sessionRevoked = false;
    global.TokenSessionStore = {
      revokeUserSessions: () => {
        sessionRevoked = true;
      }
    };

    const userId = 'usr_p5_hrd_02_' + crypto.randomBytes(4).toString('hex');
    const username = 'hrd_02_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;
    const initialHash = new WorkforceService().hashPassword('InitialSecret123!');

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Harden User 2', 'cashier', 'active', datetime('now'), datetime('now'))
    `).run(userId, brandId, orgId, username, email, initialHash);

    const wf = new WorkforceService();
    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    sessionRevoked = false; // Reset flag after token issuance; now testing completePasswordReset failure
    const tokenHash = crypto.createHash('sha256').update(reset.reset_token).digest('hex');

    // Simulate failure during user password UPDATE by intercepting prepare or throwing
    const originalPrepare = wf.repository.prepare.bind(wf.repository);
    wf.repository.prepare = function(sql) {
      if (sql.includes('UPDATE users SET password_hash')) {
        return {
          run: () => {
            throw new Error('Simulated disk/constraint error on users update');
          }
        };
      }
      return originalPrepare(sql);
    };

    assert.throws(() => {
      wf.completePasswordReset(reset.reset_token, 'ShouldFail123!');
    }, (err) => {
      assert.ok(err.message.includes('Simulated disk/constraint error'));
      return true;
    });

    // Verify rollback: token must STILL be unused (used = 0)
    const tokenRecord = db.prepare('SELECT used FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);
    assert.strictEqual(tokenRecord.used, 0, 'Token must remain unused when password update fails');

    // Verify rollback: user password must still be original
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    assert.strictEqual(user.password_hash, initialHash, 'Password must remain unchanged on rollback');

    // Verify sessions were NOT invalidated
    assert.strictEqual(sessionRevoked, false, 'Sessions must not be invalidated when reset fails');
  });

  // P5-HARDEN-03: If token consume/update transaction fails, token remains usable afterwards
  test('P5-HARDEN-03: If transaction rolls back, token remains valid and can be retried successfully', () => {
    const userId = 'usr_p5_hrd_03_' + crypto.randomBytes(4).toString('hex');
    const username = 'hrd_03_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Harden User 3', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const wf = new WorkforceService();
    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });

    // First attempt fails during transaction
    const originalPrepare = wf.repository.prepare.bind(wf.repository);
    let failOnce = true;
    wf.repository.prepare = function(sql) {
      if (failOnce && sql.includes('UPDATE users SET password_hash')) {
        failOnce = false;
        return {
          run: () => {
            throw new Error('Temporary glitch');
          }
        };
      }
      return originalPrepare(sql);
    };

    assert.throws(() => {
      wf.completePasswordReset(reset.reset_token, 'RetryPassword123!');
    });

    // Restore original prepare and retry with the SAME token
    wf.repository.prepare = originalPrepare;
    const retryResult = wf.completePasswordReset(reset.reset_token, 'RetryPassword123!');
    assert.strictEqual(retryResult.success, true);

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    assert.ok(wf.verifyPassword('RetryPassword123!', user.password_hash));
  });

  // P5-HARDEN-04: Reset token remains single-use after successful reset
  test('P5-HARDEN-04: Reset token is strictly single-use after successful reset', () => {
    const wf = new WorkforceService();
    const userId = 'usr_p5_hrd_04_' + crypto.randomBytes(4).toString('hex');
    const username = 'hrd_04_' + crypto.randomBytes(4).toString('hex');
    const email = `${username}@xentra.cloud`;

    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'Harden User 4', 'cashier', 'active', NULL, datetime('now'))
    `).run(userId, brandId, orgId, username, email);

    const reset = wf.adminResetPassword(userId, brandId, { actor_id: 'usr_p5_owner', actor_role: 'owner' });
    wf.completePasswordReset(reset.reset_token, 'FirstUsePass123!');

    assert.throws(() => {
      wf.completePasswordReset(reset.reset_token, 'SecondUsePass123!');
    }, (err) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'INVALID_TOKEN');
      return true;
    });
  });

  // ==================== FINAL HARDENING: FAIL-FAST MIGRATION ====================

  // P5-HARDEN-05: Schema migration is fail-fast and surfaces errors explicitly while restoring foreign_keys state
  test('P5-HARDEN-05: Schema migration fails fast and restores foreign_keys state when migration fails', () => {
    // Test that initSchema fails fast when an existing table structure has an error during migration
    // We can simulate this using a fresh SQLite in-memory DB
    const { DatabaseSync } = require('node:sqlite');
    const testDb = new DatabaseSync(':memory:');

    // Create legacy table with NOT NULL password_hash
    testDb.exec(`
      CREATE TABLE brands (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, slug TEXT);
      CREATE TABLE branches (id TEXT PRIMARY KEY, brand_id TEXT, name TEXT);
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        brand_id TEXT,
        organization_id TEXT,
        branch_id TEXT,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        full_name TEXT
      );
    `);

    // We can test that if a statement in migration fails (e.g., table corrupt or invalid SQL),
    // initSchema throws explicitly and restores foreign_keys to ON
    const originalExec = testDb.exec.bind(testDb);
    testDb.exec = function(sql) {
      if (sql.includes('users_plat_mig') && sql.includes('INSERT INTO users_plat_mig')) {
        throw new Error('Simulated disk corruption during data copy');
      }
      return originalExec(sql);
    };

    assert.throws(() => {
      db.initSchema(testDb);
    }, (err) => {
      assert.ok(err.message.includes('Failed to migrate users schema to nullable password_hash'));
      return true;
    });

    // Verify foreign_keys was restored to ON by finally block
    const fkState = testDb.prepare('PRAGMA foreign_keys;').get();
    const fkVal = fkState.foreign_keys !== undefined ? fkState.foreign_keys : Object.values(fkState)[0];
    assert.strictEqual(fkVal, 1, 'PRAGMA foreign_keys must be restored to 1 (ON)');
  });
});
