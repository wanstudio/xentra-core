'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  IdentityModel,
  OrganizationModel,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement,
  createIdentity,
  createOrgManager,
  createRoleManager
} = require('../../core/identity');

// ==============================================================================
// B1 — Identity Model Test (Level: Model & Lifecycle Verification)
// Requirement: creation, lookup, and lifecycle/state transitions defined by contract
// ==============================================================================
test('B1 — Identity Model: user identity creation, validation, and lifecycle state transitions', () => {
  const user = new IdentityModel({
    username: 'john_bangjo',
    email: 'john@bangjo.com',
    phone: '08123456789',
    full_name: 'John Bangjo',
    status: 'pending'
  });

  assert.ok(user.id.startsWith('usr_'));
  assert.strictEqual(user.username, 'john_bangjo');
  assert.strictEqual(user.status, 'pending');
  assert.strictEqual(user.isActive(), false);

  // Lifecycle: activate
  user.activate();
  assert.strictEqual(user.status, 'active');
  assert.strictEqual(user.isActive(), true);

  // Lifecycle: suspend
  user.suspend('Investigation into irregular activity');
  assert.strictEqual(user.status, 'suspended');
  assert.strictEqual(user.suspension_reason, 'Investigation into irregular activity');
  assert.strictEqual(user.isActive(), false);

  // Lifecycle: archive (terminal state)
  user.archive();
  assert.strictEqual(user.status, 'archived');

  // State Invariant: archived user cannot be reactivated or suspended
  assert.throws(() => user.activate(), /Cannot activate an archived user/);
  assert.throws(() => user.suspend(), /Cannot suspend an archived user/);

  // Validation: empty username rejection
  assert.throws(() => new IdentityModel({ username: '' }), /"username" is required/);
  assert.throws(() => new IdentityModel({ username: 'valid', status: 'invalid_status' }), /Invalid status/);
});

// ==============================================================================
// B2 — Organization Model Test (Level: Relationship & Structural Integrity)
// Requirement: Owner -> Brand -> Branch relationships and integrity boundary rules
// ==============================================================================
test('B2 — Organization Model: hierarchy integrity (Owner -> Brand -> Branch) & mandatory WhatsApp', () => {
  const orgManager = new OrganizationModel();

  // 1. Create Organization
  const org = orgManager.createOrganization({
    id: 'org_bangjo_holding',
    name: 'Bangjo Group Holding',
    owner_user_id: 'usr_owner_01'
  });
  assert.strictEqual(org.id, 'org_bangjo_holding');

  // 2. Create Brand under Organization
  const brand = orgManager.createBrand({
    id: 'brand_bangjo',
    organization_id: 'org_bangjo_holding',
    name: 'Ayam Tulang Lunak Bangjo'
  });
  assert.strictEqual(brand.id, 'brand_bangjo');

  // Integrity constraint: cannot create brand under non-existent org
  assert.throws(() => {
    orgManager.createBrand({ id: 'brand_orphan', organization_id: 'org_non_existent', name: 'Orphan' });
  }, /Parent organization "org_non_existent" does not exist/);

  // 3. Create Branch under Brand (with mandatory WhatsApp number)
  const branch = orgManager.createBranch({
    id: 'branch_surabaya_barat',
    brand_id: 'brand_bangjo',
    name: 'Bangjo Surabaya Barat',
    phone: '6281234567890'
  });
  assert.strictEqual(branch.id, 'branch_surabaya_barat');
  assert.strictEqual(branch.phone, '6281234567890');

  // Integrity constraint: cannot create branch without WhatsApp phone number
  assert.throws(() => {
    orgManager.createBranch({ id: 'branch_no_phone', brand_id: 'brand_bangjo', name: 'No Phone', phone: '' });
  }, /Branch phone \(WhatsApp number\) is mandatory/);

  // Relationship lookup
  assert.strictEqual(orgManager.isBranchInBrand('branch_surabaya_barat', 'brand_bangjo'), true);
  assert.strictEqual(orgManager.isBranchInBrand('branch_surabaya_barat', 'brand_other'), false);
  assert.strictEqual(orgManager.isBrandInOrganization('brand_bangjo', 'org_bangjo_holding'), true);
});

// ==============================================================================
// B3 — Role Model Test (Level: Role & Scope Assignment Verification)
// Requirement: role definitions and user assignments scoped to organization/brand/branch
// ==============================================================================
test('B3 — Role Model: role definitions and scoped user assignments', () => {
  const roleManager = new RoleModel();

  // Assign Owner (global/organization scope)
  const assignOwner = roleManager.assign({
    user_id: 'usr_owner_01',
    role: RoleModel.ROLES.OWNER,
    scope_type: 'organization',
    scope_id: 'org_bangjo_holding'
  });
  assert.strictEqual(assignOwner.role, 'owner');

  // Assign Cashier (branch scope)
  const assignCashier = roleManager.assign({
    user_id: 'usr_cashier_01',
    role: RoleModel.ROLES.CASHIER,
    scope_type: 'branch',
    scope_id: 'branch_surabaya_barat'
  });
  assert.strictEqual(assignCashier.role, 'cashier');
  assert.strictEqual(assignCashier.scope_id, 'branch_surabaya_barat');

  // Lookup assignments
  const userAssignments = roleManager.getAssignments('usr_cashier_01');
  assert.strictEqual(userAssignments.length, 1);
  assert.strictEqual(userAssignments[0].role, 'cashier');

  // Invalid role rejection
  assert.throws(() => {
    roleManager.assign({ user_id: 'usr_cashier_01', role: 'super_admin_unauthorized' });
  }, /Invalid role/);
});

// ==============================================================================
// B4 — Permission Model Test (Level: Mapping & Decision Verification)
// Requirement: authoritative Role -> Permissions mapping matching contract
// ==============================================================================
test('B4 — Permission Model: authoritative Role -> Permission mapping and completeness', () => {
  // Owner has wildcard '*'
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'branch:create'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'any:arbitrary:permission'), true);

  // Cashier has POS permissions, but NOT administrative permissions
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'order:create'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'order:accept'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'branch:create'), false);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'brand:manage'), false);

  // Kitchen has KDS permissions, cannot cancel order
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.KITCHEN, 'order:prepare'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.KITCHEN, 'order:cancel'), false);

  // Customer has menu and self order permissions
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CUSTOMER, 'menu:view'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CUSTOMER, 'branch:update'), false);
});

// ==============================================================================
// B5 — Authorization Service Test (Level: Authorization Decision Verification)
// Requirement: input identity + role/permission + resource context -> observable allow/deny
// ==============================================================================
test('B5 — Authorization Service: authorization decisions based on status, role, and scope', () => {
  const activeUser = new IdentityModel({ username: 'cashier_user', status: 'active' });
  const suspendedUser = new IdentityModel({ username: 'suspended_user', status: 'suspended' });

  const cashierAssignments = [
    {
      user_id: activeUser.id,
      role: 'cashier',
      scope_type: 'branch',
      scope_id: 'branch_surabaya_barat'
    }
  ];

  // 1. Allow: Active user with proper permission in matching branch
  const auth1 = AuthorizationService.authorize({
    identity: activeUser,
    assignments: cashierAssignments,
    required_permission: 'order:create',
    target_context: { branch_id: 'branch_surabaya_barat' }
  });
  assert.strictEqual(auth1.allowed, true);
  assert.strictEqual(auth1.granted_by_role, 'cashier');

  // 2. Deny: Active user attempting operation in DIFFERENT branch (scope mismatch)
  const auth2 = AuthorizationService.authorize({
    identity: activeUser,
    assignments: cashierAssignments,
    required_permission: 'order:create',
    target_context: { branch_id: 'branch_jakarta_selatan' }
  });
  assert.strictEqual(auth2.allowed, false);
  assert.ok(auth2.reason.includes('denied for the specified target context'));

  // 3. Deny: Suspended user is denied regardless of roles
  const auth3 = AuthorizationService.authorize({
    identity: suspendedUser,
    assignments: cashierAssignments,
    required_permission: 'order:create',
    target_context: { branch_id: 'branch_surabaya_barat' }
  });
  assert.strictEqual(auth3.allowed, false);
  assert.ok(auth3.reason.includes('not active'));

  // 4. Deny: User lacks required permission
  const auth4 = AuthorizationService.authorize({
    identity: activeUser,
    assignments: cashierAssignments,
    required_permission: 'branch:create',
    target_context: { branch_id: 'branch_surabaya_barat' }
  });
  assert.strictEqual(auth4.allowed, false);
});

// ==============================================================================
// B6 — Role Boundary Enforcement Test (Level: Boundary & Guard Verification)
// Requirement: enforces permission boundaries and throws 403 on violation
// ==============================================================================
test('B6 — Role Boundary Enforcement: enforces boundary guard and prevents cross-branch access', () => {
  const activeUser = new IdentityModel({ username: 'branch_mgr', status: 'active' });

  const managerAssignments = [
    {
      user_id: activeUser.id,
      role: 'branch_manager',
      scope_type: 'branch',
      scope_id: 'branch_surabaya_barat'
    }
  ];

  // Authorized Operation: Succeeds
  const allowed = RoleBoundaryEnforcement.enforce({
    identity: activeUser,
    assignments: managerAssignments,
    required_permission: 'order:cancel',
    target_context: { branch_id: 'branch_surabaya_barat' },
    action_name: 'Cancel Order'
  });
  assert.strictEqual(allowed, true);

  // Unauthorized Operation: Cross-branch access throws FORBIDDEN error
  assert.throws(() => {
    RoleBoundaryEnforcement.enforce({
      identity: activeUser,
      assignments: managerAssignments,
      required_permission: 'order:cancel',
      target_context: { branch_id: 'branch_surabaya_timur' },
      action_name: 'Cancel Order Cross-Branch'
    });
  }, (err) => {
    return err.code === 'FORBIDDEN' && err.status === 403 && err.message.includes('Access Denied');
  });
});
