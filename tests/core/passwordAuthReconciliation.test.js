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
});
