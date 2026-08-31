/**
 * Xentra Core Authorization Service (B5)
 * Central decision engine evaluating identity, roles, permissions, and organizational boundaries.
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
   * @returns {{ allowed: boolean, reason?: string, granted_by_role?: string }}
   */
  static authorize({ identity, assignments = [], required_permission, target_context = {} }) {
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
      const scopeMatch = AuthorizationService._matchesScope(assignment, target_context);
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
   * Evaluates whether a role assignment's scope covers the target resource context.
   */
  static _matchesScope(assignment, target) {
    // Global scope allows access across all targets
    if (assignment.scope_type === 'global' || !assignment.scope_type) {
      return true;
    }

    // Organization scope matches matching organization or any child brands/branches under it
    if (assignment.scope_type === 'organization') {
      return !target.organization_id || target.organization_id === assignment.scope_id;
    }

    // Brand scope matches matching brand or child branches of that brand
    if (assignment.scope_type === 'brand') {
      return !target.brand_id || target.brand_id === assignment.scope_id;
    }

    // Branch scope strictly matches matching branch_id
    if (assignment.scope_type === 'branch') {
      return target.branch_id === assignment.scope_id;
    }

    return false;
  }
}

module.exports = AuthorizationService;
