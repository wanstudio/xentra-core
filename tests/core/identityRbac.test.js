'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  IdentityModel,
  OrganizationModel,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement
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

  // Invalid role rejection (with explicit scope_type)
  assert.throws(() => {
    roleManager.assign({ user_id: 'usr_cashier_01', role: 'super_admin_unauthorized', scope_type: 'branch', scope_id: 'branch_surabaya_barat' });
  }, /Invalid role/);

  // Mandatory scope_type rejection
  assert.throws(() => {
    roleManager.assign({ user_id: 'usr_cashier_01', role: 'cashier' });
  }, /"scope_type" is mandatory/);
});

// ==============================================================================
// B4 — Permission Model Test (Level: Mapping & Decision Verification)
// Requirement: authoritative Role -> Permissions mapping matching contract
// ==============================================================================
test('B4 — Permission Model: authoritative Role -> Permission mapping and completeness', () => {
  // Owner has explicit high-privilege management permissions
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'branch:create'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'staff:manage'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'order:refund'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'inventory:manage'), true);

  // Brand Manager has staff management and brand authority, but not org:manage
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRAND_MANAGER, 'staff:manage'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRAND_MANAGER, 'branch:create'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRAND_MANAGER, 'org:manage'), false);

  // Branch Manager has refund, staff view, inventory manage, and order processing permissions
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'order:refund'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'inventory:manage'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'staff:view'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'staff:manage'), false);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'branch:create'), false);

  // Cashier has POS permissions, cannot refund or update branch
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'order:create'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'order:accept'), true);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'order:refund'), false);
  assert.strictEqual(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'branch:update'), false);
});

// ==============================================================================
// B5 — Authorization Service Test (Level: Authorization Decision Verification)
// Requirement: input identity + role/permission + resource context -> observable allow/deny
// ==============================================================================
test('B5 — Authorization Service: strict decision matrix (same scope, child scope, different scope, missing context)', () => {
  const orgManager = new OrganizationModel();
  orgManager.createOrganization({ id: 'org_bangjo', name: 'Bangjo Org', owner_user_id: 'usr_owner' });
  orgManager.createBrand({ id: 'brand_bangjo', organization_id: 'org_bangjo', name: 'Bangjo Brand' });
  orgManager.createBranch({ id: 'branch_surabaya', brand_id: 'brand_bangjo', name: 'Surabaya Branch', phone: '08111' });
  orgManager.createBranch({ id: 'branch_jakarta', brand_id: 'brand_bangjo', name: 'Jakarta Branch', phone: '08222' });

  const activeUser = new IdentityModel({ username: 'branch_mgr', status: 'active' });
  const brandMgrUser = new IdentityModel({ username: 'brand_mgr', status: 'active' });
  const suspendedUser = new IdentityModel({ username: 'suspended_user', status: 'suspended' });

  const branchMgrAssignments = [{
    user_id: activeUser.id,
    role: 'branch_manager',
    scope_type: 'branch',
    scope_id: 'branch_surabaya'
  }];

  const brandMgrAssignments = [{
    user_id: brandMgrUser.id,
    role: 'brand_manager',
    scope_type: 'brand',
    scope_id: 'brand_bangjo'
  }];

  // 1. Same scope: ALLOW
  const sameScope = AuthorizationService.authorize({
    identity: activeUser,
    assignments: branchMgrAssignments,
    required_permission: 'order:refund',
    target_context: { branch_id: 'branch_surabaya' }
  });
  assert.strictEqual(sameScope.allowed, true);

  // 2. Child scope: Brand Manager accessing child branch under that brand -> ALLOW
  const childScope = AuthorizationService.authorize({
    identity: brandMgrUser,
    assignments: brandMgrAssignments,
    required_permission: 'branch:update',
    target_context: { branch_id: 'branch_surabaya' },
    orgHierarchy: orgManager
  });
  assert.strictEqual(childScope.allowed, true);

  // 3. Different scope: Surabaya manager accessing Jakarta branch -> DENY
  const diffScope = AuthorizationService.authorize({
    identity: activeUser,
    assignments: branchMgrAssignments,
    required_permission: 'order:refund',
    target_context: { branch_id: 'branch_jakarta' }
  });
  assert.strictEqual(diffScope.allowed, false);

  // 4. Missing target context: Branch action without target context -> DENY
  const missingContext = AuthorizationService.authorize({
    identity: activeUser,
    assignments: branchMgrAssignments,
    required_permission: 'order:refund',
    target_context: {}
  });
  assert.strictEqual(missingContext.allowed, false);

  // 5. Inactive Identity -> DENY
  const inactive = AuthorizationService.authorize({
    identity: suspendedUser,
    assignments: branchMgrAssignments,
    required_permission: 'order:refund',
    target_context: { branch_id: 'branch_surabaya' }
  });
  assert.strictEqual(inactive.allowed, false);
  assert.ok(inactive.reason.includes('not active'));

  // 6. No permission -> DENY
  const noPerm = AuthorizationService.authorize({
    identity: activeUser,
    assignments: branchMgrAssignments,
    required_permission: 'org:manage',
    target_context: { branch_id: 'branch_surabaya' }
  });
  assert.strictEqual(noPerm.allowed, false);

  // 7. P1 SECURITY TEST: Organization Scope with empty/unverifiable target context -> MUST FAIL-CLOSED (DENY)
  const orgUser = new IdentityModel({ username: 'org_admin', status: 'active' });
  const orgAssignments = [{
    user_id: orgUser.id,
    role: 'owner',
    scope_type: 'organization',
    scope_id: 'org_bangjo'
  }];

  const orgEmptyContext = AuthorizationService.authorize({
    identity: orgUser,
    assignments: orgAssignments,
    required_permission: 'org:manage',
    target_context: {} // Empty target context without organization_id or verifiable brand
  });
  assert.strictEqual(orgEmptyContext.allowed, false, 'Organization scope with empty target context must fail-closed (DENY)');

  // 8. Missing/Undefined scope_type in assignment -> MUST FAIL-CLOSED (DENY, never assumed global)
  const invalidScopeAssignment = [{
    user_id: orgUser.id,
    role: 'owner',
    scope_type: undefined,
    scope_id: 'org_bangjo'
  }];
  const invalidScopeResult = AuthorizationService.authorize({
    identity: orgUser,
    assignments: invalidScopeAssignment,
    required_permission: 'org:manage',
    target_context: { organization_id: 'org_bangjo' }
  });
  assert.strictEqual(invalidScopeResult.allowed, false, 'Missing scope_type must fail-closed (DENY)');
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

// ==============================================================================
// B7 — Role Provisioning & Delegation Matrix Test (Level: Actor Authority Verification)
// Requirement: verifies that assigning roles respects caller authorization boundaries
// - Cashier -> assign cashier -> DENY (cannot manage staff)
// - Branch Manager -> assign cashier own branch -> ALLOW (staff:view/manage scope)
// - Branch Manager -> assign cashier other branch -> DENY
// - Owner -> assign global -> ALLOW
// ==============================================================================
test('B7 — Role Provisioning Matrix: verifies actor authorization on role assignment delegation', () => {
  const roleManager = new RoleModel();

  const ownerUser = new IdentityModel({ username: 'owner_user', status: 'active' });
  const brandMgrUser = new IdentityModel({ username: 'brand_mgr_user', status: 'active' });
  const branchMgrUser = new IdentityModel({ username: 'branch_mgr_user', status: 'active' });
  const cashierUser = new IdentityModel({ username: 'cashier_user', status: 'active' });
  const targetStaff = new IdentityModel({ username: 'new_staff', status: 'active' });

  const ownerAssignments = [{
    user_id: ownerUser.id,
    role: RoleModel.ROLES.OWNER,
    scope_type: 'organization',
    scope_id: 'org_bangjo'
  }];

  const brandMgrAssignments = [{
    user_id: brandMgrUser.id,
    role: RoleModel.ROLES.BRAND_MANAGER,
    scope_type: 'brand',
    scope_id: 'brand_bangjo'
  }];

  const branchMgrAssignments = [{
    user_id: branchMgrUser.id,
    role: RoleModel.ROLES.BRANCH_MANAGER,
    scope_type: 'branch',
    scope_id: 'branch_barat'
  }];

  const cashierAssignments = [{
    user_id: cashierUser.id,
    role: RoleModel.ROLES.CASHIER,
    scope_type: 'branch',
    scope_id: 'branch_barat'
  }];

  const orgManager = new OrganizationModel();
  orgManager.createOrganization({ id: 'org_bangjo', name: 'Bangjo Org', owner_user_id: ownerUser.id });
  orgManager.createBrand({ id: 'brand_bangjo', organization_id: 'org_bangjo', name: 'Bangjo Brand' });
  orgManager.createBranch({ id: 'branch_barat', brand_id: 'brand_bangjo', name: 'Surabaya Barat', phone: '08111' });
  orgManager.createBranch({ id: 'branch_timur', brand_id: 'brand_bangjo', name: 'Surabaya Timur', phone: '08222' });

  // Helper simulating authorized provisioning boundary gate
  function authorizeAndAssign({ actor, actorAssignments, targetUserId, newRole, targetScopeType, targetScopeId }) {
    // 1. Check if actor is attempting global / owner assignment
    if (newRole === RoleModel.ROLES.OWNER || targetScopeType === 'global') {
      const isOwner = actorAssignments.some(a => a.role === RoleModel.ROLES.OWNER);
      if (!isOwner) {
        const err = new Error('FORBIDDEN: Only Owner can assign global or owner roles.');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }
    }

    // 2. Authorize via staff management permission against target branch/brand/org context
    const targetContext = {};
    if (targetScopeType === 'organization') targetContext.organization_id = targetScopeId;
    if (targetScopeType === 'brand') targetContext.brand_id = targetScopeId;
    if (targetScopeType === 'branch') {
      targetContext.branch_id = targetScopeId;
      targetContext.brand_id = 'brand_bangjo';
    }
    if (targetScopeType === 'global') {
      const actorOrg = actorAssignments.find(a => a.scope_type === 'organization')?.scope_id;
      if (actorOrg) targetContext.organization_id = actorOrg;
    }

    RoleBoundaryEnforcement.enforce({
      identity: actor,
      assignments: actorAssignments,
      required_permission: 'staff:manage',
      target_context: targetContext,
      action_name: `Assign Role ${newRole}`
    });

    // 3. Delegate to RoleModel once authorized
    return roleManager.assign({
      user_id: targetUserId,
      role: newRole,
      scope_type: targetScopeType,
      scope_id: targetScopeId,
      assigned_by: actor.id
    });
  }

  // 1. Cashier -> assign cashier -> MUST BE DENIED (Cashier lacks staff:manage permission)
  assert.throws(() => {
    authorizeAndAssign({
      actor: cashierUser,
      actorAssignments: cashierAssignments,
      targetUserId: targetStaff.id,
      newRole: RoleModel.ROLES.CASHIER,
      targetScopeType: 'branch',
      targetScopeId: 'branch_barat'
    });
  }, /Access Denied/);

  // 2. Branch Manager -> assign cashier -> MUST BE DENIED (Branch Manager lacks staff:manage in contract)
  assert.throws(() => {
    authorizeAndAssign({
      actor: branchMgrUser,
      actorAssignments: branchMgrAssignments,
      targetUserId: targetStaff.id,
      newRole: RoleModel.ROLES.CASHIER,
      targetScopeType: 'branch',
      targetScopeId: 'branch_barat'
    });
  }, /Access Denied/);

  // 3. Brand Manager -> assign global role -> MUST BE DENIED (Non-owner escalation forbidden)
  assert.throws(() => {
    authorizeAndAssign({
      actor: brandMgrUser,
      actorAssignments: brandMgrAssignments,
      targetUserId: targetStaff.id,
      newRole: RoleModel.ROLES.OWNER,
      targetScopeType: 'global',
      targetScopeId: null
    });
  }, /Only Owner can assign global or owner roles/);

  // 4. Brand Manager -> assign cashier in child branch -> MUST BE ALLOWED
  const brandMgrAssignCashier = authorizeAndAssign({
    actor: brandMgrUser,
    actorAssignments: brandMgrAssignments,
    targetUserId: targetStaff.id,
    newRole: RoleModel.ROLES.CASHIER,
    targetScopeType: 'branch',
    targetScopeId: 'branch_barat'
  });
  assert.strictEqual(brandMgrAssignCashier.role, 'cashier');
  assert.strictEqual(brandMgrAssignCashier.scope_id, 'branch_barat');
  assert.strictEqual(brandMgrAssignCashier.assigned_by, brandMgrUser.id);

  // 5. Owner -> assign global role -> MUST BE ALLOWED
  const ownerAssignGlobal = authorizeAndAssign({
    actor: ownerUser,
    actorAssignments: ownerAssignments,
    targetUserId: targetStaff.id,
    newRole: RoleModel.ROLES.OWNER,
    targetScopeType: 'global',
    targetScopeId: null
  });
  assert.strictEqual(ownerAssignGlobal.role, 'owner');
  assert.strictEqual(ownerAssignGlobal.scope_type, 'global');
  assert.strictEqual(ownerAssignGlobal.assigned_by, ownerUser.id);
});
