/**
 * Xentra Core Role Boundary Enforcement (B6)
 * Interceptor and boundary guard preventing cross-tenant / cross-branch privilege escalations.
 */
const AuthorizationService = require('./AuthorizationService');

class RoleBoundaryEnforcement {
  /**
   * Enforces that a given action strictly complies with authorization boundaries.
   * Throws an Error with 403 Forbidden semantics if authorization fails.
   * 
   * @param {Object} params
   * @param {Object} params.identity - IdentityModel or user object
   * @param {Array<Object>} params.assignments - User role assignments
   * @param {string} params.required_permission - The required permission string
   * @param {Object} [params.target_context] - Target resource context { organization_id, brand_id, branch_id }
   * @param {string} [params.action_name='Operation'] - Human-readable action description for audit
   * @returns {boolean} Returns true if allowed, otherwise throws Error.
   */
  static enforce({
    identity,
    assignments,
    required_permission,
    target_context = {},
    action_name = 'Operation'
  }) {
    const authResult = AuthorizationService.authorize({
      identity,
      assignments,
      required_permission,
      target_context
    });

    if (!authResult.allowed) {
      const err = new Error(`[RoleBoundaryEnforcement] Access Denied for ${action_name}: ${authResult.reason}`);
      err.code = 'FORBIDDEN';
      err.status = 403;
      err.details = {
        user_id: identity?.id,
        required_permission,
        target_context
      };
      throw err;
    }

    return true;
  }
}

module.exports = RoleBoundaryEnforcement;
