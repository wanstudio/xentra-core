/**
 * Xentra Core Identity & RBAC Module (Milestone B)
 * Unified exports for Identity, Organization, Role, Permission, Authorization, and Boundary Enforcement.
 */
const IdentityModel = require('./IdentityModel');
const OrganizationModel = require('./OrganizationModel');
const RoleModel = require('./RoleModel');
const PermissionModel = require('./PermissionModel');
const AuthorizationService = require('./AuthorizationService');
const RoleBoundaryEnforcement = require('./RoleBoundaryEnforcement');

module.exports = {
  IdentityModel,
  OrganizationModel,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement,

  // Factory Helpers
  createIdentity: (params) => new IdentityModel(params),
  createOrgManager: () => new OrganizationModel(),
  createRoleManager: () => new RoleModel()
};
