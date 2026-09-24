/**
 * Xentra Core Identity & RBAC Module (Milestone B)
 * Unified exports for Identity, Organization, Role, Permission, Authorization, Boundary Enforcement, and Workforce Management.
 */
const IdentityModel = require('./IdentityModel');
const OrganizationModel = require('./OrganizationModel');
const RoleModel = require('./RoleModel');
const PermissionModel = require('./PermissionModel');
const AuthorizationService = require('./AuthorizationService');
const RoleBoundaryEnforcement = require('./RoleBoundaryEnforcement');
const WorkforceService = require('./WorkforceService');
const WorkforceInvitationService = require('./WorkforceInvitationService');
const WorkforceMembershipService = require('./WorkforceMembershipService');
const RegistrationService = require('./RegistrationService');
const EmailVerificationService = require('./EmailVerificationService');
const PlatformBootstrapService = require('./PlatformBootstrapService');
const AuthProviderService = require('./AuthProviderService');
const HandoffService = require('./HandoffService');
const ExistingTenantResolver = require('./ExistingTenantResolver');
const OwnershipClaimService = require('./OwnershipClaimService');
const TenantOwnershipTransferService = require('./TenantOwnershipTransferService');
const CustomerIdentityService = require('./CustomerIdentityService');
const { EmailProvider, defaultEmailProvider, ResendEmailAdapter } = require('./EmailProvider');

module.exports = {
  IdentityModel,
  OrganizationModel,
  RoleModel,
  PermissionModel,
  AuthorizationService,
  RoleBoundaryEnforcement,
  WorkforceService,
  WorkforceInvitationService,
  WorkforceMembershipService,
  RegistrationService,
  EmailVerificationService,
  PlatformBootstrapService,
  AuthProviderService,
  HandoffService,
  ExistingTenantResolver,
  OwnershipClaimService,
  TenantOwnershipTransferService,
  CustomerIdentityService,
  EmailProvider,
  defaultEmailProvider,
  ResendEmailAdapter,

  // Factory Helpers
  createIdentity: (params) => new IdentityModel(params),
  createOrgManager: () => new OrganizationModel(),
  createRoleManager: () => new RoleModel()
};
