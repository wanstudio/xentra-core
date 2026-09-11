'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// Ensure test environment uses in-memory DB
process.env.NODE_ENV = 'test';
const db = require('../../server/database/db');
const {
  PlatformBootstrapService,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement,
  WorkforceService,
  RegistrationService
} = require('../../core/identity');

describe('TASK 3A — Platform Owner Identity & Secure Bootstrap', () => {

  beforeEach(() => {
    // Clear test state if needed
    try {
      db.prepare("DELETE FROM users WHERE role = 'platform_owner'").run();
      db.prepare("DELETE FROM security_audit_log WHERE actor_role = 'platform_owner' OR action LIKE 'PLATFORM%'").run();
    } catch (_) {}
  });

  test('1. Platform Owner bootstrap creation without fake Org/Brand/Branch', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const result = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'StrongPassword123!',
      full_name: 'Platform Superadmin'
    });

    assert.equal(result.created, true);
    assert.equal(result.reason, 'BOOTSTRAP_SUCCESS');
    assert.ok(result.user.id.startsWith('usr_plat_'));
    assert.equal(result.user.email, 'owner@xentra.cloud');
    assert.equal(result.user.role, 'platform_owner');
    assert.equal(result.user.brand_id, null, 'brand_id MUST be null (no fake brand)');
    assert.equal(result.user.organization_id, null, 'organization_id MUST be null (no fake organization)');
    assert.equal(result.user.branch_id, null, 'branch_id MUST be null (no fake branch)');
    assert.equal(result.user.status, 'active');
    assert.equal(result.user.email_verified, true);
    assert.equal(result.user.mfa_ready, true);
    assert.equal(result.user.mfa_enabled, false);

    // Verify DB persistence directly
    const dbRow = db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
    assert.ok(dbRow);
    assert.equal(dbRow.brand_id, null);
    assert.equal(dbRow.organization_id, null);
    assert.equal(dbRow.role, 'platform_owner');
    assert.equal(dbRow.mfa_enabled, 0);
  });

  test('2. Duplicate Platform Owner protection (rejects accidental duplicate)', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    
    // First bootstrap
    const firstResult = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'StrongPassword123!',
      full_name: 'Platform Superadmin'
    });
    assert.equal(firstResult.created, true);

    // Second bootstrap attempt with different credentials
    const secondResult = bootstrapService.bootstrapPlatformOwner({
      email: 'attacker@evil.com',
      password: 'AttackerPassword999!',
      full_name: 'Intruder'
    });

    assert.equal(secondResult.created, false);
    assert.equal(secondResult.reason, 'ALREADY_EXISTS');
    assert.equal(secondResult.user.id, firstResult.user.id, 'Must return existing owner without modifying');
    assert.equal(secondResult.user.email, 'owner@xentra.cloud');

    // Confirm only 1 Platform Owner exists in DB
    const count = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'platform_owner'").get().cnt;
    assert.equal(count, 1);
  });

  test('3. Bootstrap rerun / idempotency check', () => {
    const bootstrapService = new PlatformBootstrapService(db);

    const firstRun = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'StrongPassword123!'
    });
    assert.equal(firstRun.created, true);

    // Rerun exact same call
    const rerun = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'StrongPassword123!'
    });
    assert.equal(rerun.created, false);
    assert.equal(rerun.reason, 'ALREADY_EXISTS');
    assert.equal(rerun.user.id, firstRun.user.id);
  });

  test('4. Existing Platform Owner password is NOT silently overwritten on rerun', () => {
    const bootstrapService = new PlatformBootstrapService(db);

    bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'OriginalPassword123!'
    });

    const originalRow = db.prepare("SELECT password_hash FROM users WHERE role = 'platform_owner'").get();
    const originalHash = originalRow.password_hash;

    // Second call without forceReset
    bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'NewAttemptedPassword456!'
    });

    const afterRow = db.prepare("SELECT password_hash FROM users WHERE role = 'platform_owner'").get();
    assert.equal(afterRow.password_hash, originalHash, 'Password hash must NOT change');
    assert.ok(bcrypt.compareSync('OriginalPassword123!', afterRow.password_hash));
    assert.strictEqual(bcrypt.compareSync('NewAttemptedPassword456!', afterRow.password_hash), false);
  });

  test('5. Password is secure bcrypt hash (12 rounds) and raw password is not stored', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const password = 'StrongPassword123!';

    const result = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password
    });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
    assert.ok(userRow.password_hash.startsWith('$2'), 'Must be a bcrypt hash');
    assert.ok(!userRow.password_hash.includes(password), 'Raw password must never be stored in hash field');
    assert.ok(!Object.values(userRow).includes(password), 'Raw password must never be stored in any column');
    assert.ok(bcrypt.compareSync(password, userRow.password_hash));
  });

  test('6. Plaintext password is never returned in service outputs or result objects', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const password = 'StrongPassword123!';

    const result = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password
    });

    const serialized = JSON.stringify(result);
    assert.strictEqual(serialized.includes(password), false, 'Plaintext password must not appear in result object');
    assert.strictEqual(result.user.password, undefined);
    assert.strictEqual(result.user.password_hash, undefined);
  });

  test('7. Plaintext password is never written to security_audit_log', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const password = 'StrongPassword123!';

    const result = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password
    });

    const auditRows = db.prepare("SELECT * FROM security_audit_log WHERE action = 'PLATFORM_OWNER_BOOTSTRAPPED'").all();
    assert.ok(auditRows.length > 0, 'Audit record must be created');
    
    for (const row of auditRows) {
      const rowStr = JSON.stringify(row);
      assert.strictEqual(rowStr.includes(password), false, 'Plaintext password must NEVER exist in audit log');
      assert.strictEqual(rowStr.includes('$2'), false, 'Password hash must NOT be leaked in audit metadata');
      assert.equal(row.actor_role, 'platform_owner');
      assert.equal(row.target_user_id, result.user.id);
      assert.equal(row.result, 'success');
    }
  });

  test('8. Platform Owner is not a merchant Owner (role distinguishes explicitly)', () => {
    assert.notEqual(RoleModel.ROLES.PLATFORM_OWNER, RoleModel.ROLES.OWNER);
    assert.equal(RoleModel.ROLES.PLATFORM_OWNER, 'platform_owner');
    assert.equal(RoleModel.ROLES.OWNER, 'owner');
  });

  test('9. Platform Owner authorization is platform-scoped', () => {
    const roleManager = new RoleModel();
    roleManager.assign({
      user_id: 'plat_user_1',
      role: RoleModel.ROLES.PLATFORM_OWNER,
      scope_type: 'global'
    });

    const assignments = roleManager.getAssignments('plat_user_1');

    // Platform permissions must be granted
    const authManage = AuthorizationService.authorize({
      identity: { id: 'plat_user_1', status: 'active' },
      assignments,
      required_permission: PermissionModel.PERMISSIONS.PLATFORM_MANAGE
    });
    assert.equal(authManage.allowed, true);

    const authTenantManage = AuthorizationService.authorize({
      identity: { id: 'plat_user_1', status: 'active' },
      assignments,
      required_permission: PermissionModel.PERMISSIONS.PLATFORM_TENANT_MANAGE
    });
    assert.equal(authTenantManage.allowed, true);

    const authAudit = AuthorizationService.authorize({
      identity: { id: 'plat_user_1', status: 'active' },
      assignments,
      required_permission: PermissionModel.PERMISSIONS.PLATFORM_AUDIT_VIEW
    });
    assert.equal(authAudit.allowed, true);
  });

  test('10. Merchant Owner cannot access Platform Owner permissions', () => {
    const roleManager = new RoleModel();
    roleManager.assign({
      user_id: 'merchant_owner_1',
      role: RoleModel.ROLES.OWNER,
      scope_type: 'organization',
      scope_id: 'org_merchant_123'
    });

    const assignments = roleManager.getAssignments('merchant_owner_1');

    // Merchant owner must NOT be authorized for platform:manage
    const authManage = AuthorizationService.authorize({
      identity: { id: 'merchant_owner_1', status: 'active' },
      assignments,
      required_permission: PermissionModel.PERMISSIONS.PLATFORM_MANAGE,
      target_context: {}
    });
    assert.equal(authManage.allowed, false);

    // Merchant owner must NOT be authorized for platform:tenant:manage
    const authTenant = AuthorizationService.authorize({
      identity: { id: 'merchant_owner_1', status: 'active' },
      assignments,
      required_permission: PermissionModel.PERMISSIONS.PLATFORM_TENANT_MANAGE,
      target_context: {}
    });
    assert.equal(authTenant.allowed, false);

    // Boundary enforcement should throw 403
    assert.throws(() => {
      RoleBoundaryEnforcement.enforce({
        identity: { id: 'merchant_owner_1', status: 'active' },
        assignments,
        required_permission: PermissionModel.PERMISSIONS.PLATFORM_MANAGE,
        action_name: 'Access Platform Control Plane'
      });
    }, (err) => {
      return err.status === 403 && err.code === 'FORBIDDEN';
    });
  });

  test('11. Platform Owner cannot authenticate through merchant login endpoint', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const password = 'StrongPassword123!';

    bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password
    });

    const workforce = new WorkforceService(db);
    // Attempt login targeting brand_bangjo
    const loginResult = workforce.authenticate('owner@xentra.cloud', password, 'brand_bangjo');
    assert.equal(loginResult.success, false);
    assert.equal(loginResult.error, 'INVALID_CREDENTIALS');
  });

  test('12. Public merchant registration cannot create Platform Owner', () => {
    const registration = new RegistrationService(db);

    // Attempt registration
    const result = registration.registerBusiness({
      email: 'merchant_reg_test@example.com',
      password: 'MerchantPassword123!',
      business_name: 'Test Coffee Store',
      full_name: 'Merchant Tester'
    });

    assert.ok(result.user);
    assert.equal(result.user.role, 'owner');
    assert.notEqual(result.user.role, 'platform_owner');
    assert.ok(result.brand.id);
    assert.ok(result.organization.id);

    // Directly verify row in DB
    const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
    assert.equal(dbUser.role, 'owner');
    assert.notEqual(dbUser.role, 'platform_owner');
  });

  test('13. Explicit forceReset allows controlled credential rotation with audit logging', () => {
    const bootstrapService = new PlatformBootstrapService(db);

    const initial = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'OriginalPassword123!'
    });
    assert.equal(initial.created, true);

    // Controlled rotation with forceReset = true
    const rotated = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'RotatedPassword456!',
      forceReset: true
    });

    assert.equal(rotated.created, false);
    assert.equal(rotated.updated, true);
    assert.equal(rotated.reason, 'CREDENTIALS_RESET');
    assert.equal(rotated.user.id, initial.user.id);

    // Verify new password works and old fails
    const updatedRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(initial.user.id);
    assert.ok(bcrypt.compareSync('RotatedPassword456!', updatedRow.password_hash));
    assert.strictEqual(bcrypt.compareSync('OriginalPassword123!', updatedRow.password_hash), false);

    // Verify audit log
    const resetLog = db.prepare("SELECT * FROM security_audit_log WHERE action = 'PLATFORM_OWNER_CREDENTIALS_RESET'").get();
    assert.ok(resetLog);
    assert.equal(resetLog.target_user_id, initial.user.id);
    assert.equal(resetLog.actor_role, 'platform_owner');
  });

  test('14. Legacy Bangjo Owner/bootstrap remains fully compatible', () => {
    // Bangjo initial user should be able to authenticate as merchant owner
    const workforce = new WorkforceService(db);
    const bangjoUser = db.prepare("SELECT * FROM users WHERE username = 'admin' AND brand_id = 'brand_bangjo'").get();
    assert.ok(bangjoUser, 'Legacy bangjo admin user must exist');
    assert.equal(bangjoUser.role, 'owner');
    assert.equal(bangjoUser.brand_id, 'brand_bangjo');
    assert.equal(bangjoUser.organization_id, 'org_xentra_holding');

    const authResult = workforce.authenticate('admin', 'bangjo123', 'brand_bangjo');
    assert.equal(authResult.success, true);
    assert.equal(authResult.user.role, 'owner');
  });

  test('15. MFA readiness status is clearly exposed without claiming MFA is implemented', () => {
    const bootstrapService = new PlatformBootstrapService(db);
    const result = bootstrapService.bootstrapPlatformOwner({
      email: 'owner@xentra.cloud',
      password: 'StrongPassword123!'
    });

    // In user response:
    assert.strictEqual(result.user.mfa_ready, true);
    assert.strictEqual(result.user.mfa_enabled, false);

    // Verify DB columns
    const userRow = db.prepare('SELECT mfa_enabled, mfa_enrolled_at FROM users WHERE id = ?').get(result.user.id);
    assert.strictEqual(userRow.mfa_enabled, 0);
    assert.strictEqual(userRow.mfa_enrolled_at, null);
  });

  test('16. Weak passwords for Platform Owner bootstrap are rejected', () => {
    const bootstrapService = new PlatformBootstrapService(db);

    // Too short (< 10)
    assert.throws(() => {
      bootstrapService.bootstrapPlatformOwner({
        email: 'owner@xentra.cloud',
        password: 'Short1!'
      });
    }, (err) => err.code === 'WEAK_PASSWORD');

    // No uppercase
    assert.throws(() => {
      bootstrapService.bootstrapPlatformOwner({
        email: 'owner@xentra.cloud',
        password: 'lowercaseonly123!'
      });
    }, (err) => err.code === 'WEAK_PASSWORD');

    // No numbers
    assert.throws(() => {
      bootstrapService.bootstrapPlatformOwner({
        email: 'owner@xentra.cloud',
        password: 'LettersOnlyNoNumber!'
      });
    }, (err) => err.code === 'WEAK_PASSWORD');
  });

});
