/**
 * Xentra Core Authorization Service (B5)
 * Central decision engine evaluating identity, roles, permissions, and strict organizational boundaries.
 */
const PermissionModel = require('./PermissionModel');

class AuthorizationService {
  /**
   * Evaluates if an identity is authorized to perform a permission within a target context.
   * 
   * @param {Object} params
   * @param {Object} params.identity - IdentityModel instance or plain user object { id, status }
   * @param {Array<Object>} params.assignments - Array of role assignments for this user
   * @param {string} params.required_permission - The permission required (e.g. 'order:create', 'branch:update')
   * @param {Object} [params.target_context] - Target resource context { organization_id, brand_id, branch_id }
   * @param {Object} [params.orgHierarchy] - Optional OrganizationModel to verify parent-child brand/branch relations
   * @returns {{ allowed: boolean, reason?: string, granted_by_role?: string }}
   */
  static authorize({
    identity,
    assignments = [],
    required_permission,
    target_context = {},
    orgHierarchy = null
  }) {
    if (!identity) {
      return { allowed: false, reason: 'Identity is missing or unauthenticated.' };
    }

    if (identity.status && identity.status !== 'active') {
      return { allowed: false, reason: `User identity is not active (current status: "${identity.status}").` };
    }

    if (!required_permission || typeof required_permission !== 'string') {
      return { allowed: false, reason: 'Required permission is not specified.' };
    }

    if (!assignments || assignments.length === 0) {
      return { allowed: false, reason: 'No role assignments found for user.' };
    }

    // Evaluate each role assignment against required permission and scope match
    for (const assignment of assignments) {
      const hasPerm = PermissionModel.hasPermission(assignment.role, required_permission);
      if (!hasPerm) continue;

      // Check Scope Match
      const scopeMatch = AuthorizationService._matchesScope(assignment, target_context, orgHierarchy);
      if (scopeMatch) {
        return {
          allowed: true,
          granted_by_role: assignment.role
        };
      }
    }

    return {
      allowed: false,
      reason: `Permission "${required_permission}" denied for the specified target context.`
    };
  }

  /**
   * Evaluates whether a role assignment's scope strictly covers the target resource context.
   */
  static _matchesScope(assignment, target = {}, orgHierarchy = null) {
    if (!assignment || !assignment.scope_type) {
      // P1 SECURITY HARDENING: Fail-Closed. Missing scope_type is strictly DENIED (never assumed global)
      return false;
    }

    // 1. Explicit Global Scope allows access everywhere
    if (assignment.scope_type === 'global') {
      return true;
    }

    // 2. Organization Scope: Must match organization_id or child brand/branch via verified hierarchy
    if (assignment.scope_type === 'organization') {
      if (!assignment.scope_id) return false;

      // Direct organization match
      if (target.organization_id) {
        return target.organization_id === assignment.scope_id;
      }
      // Child brand match via hierarchy
      if (target.brand_id && orgHierarchy) {
        return orgHierarchy.isBrandInOrganization(target.brand_id, assignment.scope_id);
      }
      // Child branch match via hierarchy (branch belongs to a brand in this org)
      if (target.branch_id && orgHierarchy) {
        const branchBrand = orgHierarchy.getBranchBrandId ? orgHierarchy.getBranchBrandId(target.branch_id) : null;
        if (branchBrand) {
          return orgHierarchy.isBrandInOrganization(branchBrand, assignment.scope_id);
        }
      }

      // P1 SECURITY HARDENING: Fail-Closed. If target context is empty or unverifiable, strictly DENY
      return false;
    }

    // 3. Brand Scope
    if (assignment.scope_type === 'brand') {
      if (!assignment.scope_id) return false;

      // Direct brand match
      if (target.brand_id && target.brand_id === assignment.scope_id) {
        return true;
      }
      // Child branch match via hierarchy
      if (target.branch_id && orgHierarchy) {
        return orgHierarchy.isBranchInBrand(target.branch_id, assignment.scope_id);
      }
      // If only branch_id provided without hierarchy, reject to maintain strict boundary
      if (target.branch_id && !target.brand_id && !orgHierarchy) {
        return false;
      }
      return Boolean(target.brand_id && target.brand_id === assignment.scope_id);
    }

    // 4. Branch Scope
    if (assignment.scope_type === 'branch') {
      if (!assignment.scope_id) return false;
      // Strictly requires target.branch_id and must match assignment.scope_id
      return Boolean(target.branch_id && target.branch_id === assignment.scope_id);
    }

    return false;
  }
}

module.exports = AuthorizationService;
