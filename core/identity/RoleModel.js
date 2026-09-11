/**
 * Xentra Core Role Model (B3)
 * Defines authorized roles, scopes, and user-role assignment records.
 */
class RoleModel {
  /**
   * Recognized Role Constants & Standard Scopes:
   * - 'owner': Organization-wide authority.
   * - 'brand_manager': Brand-scoped authority.
   * - 'branch_manager': Branch-scoped authority.
   * - 'cashier': POS branch operational authority.
   * - 'kitchen': KDS branch display authority.
   * - 'customer': Customer self-service scope.
   */
  static ROLES = {
    PLATFORM_OWNER: 'platform_owner',
    OWNER: 'owner',
    BRAND_MANAGER: 'brand_manager',
    BRANCH_MANAGER: 'branch_manager',
    CASHIER: 'cashier',
    KITCHEN: 'kitchen',
    CUSTOMER: 'customer'
  };

  constructor() {
    this._assignments = []; // Array<{ user_id, role, scope_type, scope_id }>
  }

  /**
   * Assigns a role to a user with a specific organizational scope.
   * P1 HARDENING: scope_type is strictly required (never defaults to 'global').
   * 
   * @param {Object} params
   * @param {string} params.user_id
   * @param {string} params.role
   * @param {'organization'|'brand'|'branch'|'global'} params.scope_type
   * @param {string} [params.scope_id]
   * @param {Object} [params.assigned_by] - Identity making this assignment
   */
  assign({ user_id, role, scope_type, scope_id = null, assigned_by = null }) {
    if (!user_id || !role) {
      throw new Error('[RoleModel] "user_id" and "role" are required.');
    }

    if (!scope_type) {
      throw new Error('[RoleModel] "scope_type" is mandatory and must be explicitly specified (organization, brand, branch, or global).');
    }

    const validScopes = ['organization', 'brand', 'branch', 'global'];
    if (!validScopes.includes(scope_type)) {
      throw new Error(`[RoleModel] Invalid scope_type "${scope_type}". Allowed: ${validScopes.join(', ')}`);
    }

    const validRoles = Object.values(RoleModel.ROLES);
    if (!validRoles.includes(role)) {
      throw new Error(`[RoleModel] Invalid role "${role}". Allowed: ${validRoles.join(', ')}`);
    }

    // P1 Escalation Guard: Non-global scope requires scope_id
    if (scope_type !== 'global' && !scope_id) {
      throw new Error(`[RoleModel] "scope_id" is mandatory for scope_type "${scope_type}".`);
    }

    const assignment = {
      user_id: user_id.trim(),
      role: role.trim(),
      scope_type,
      scope_id: scope_id ? scope_id.trim() : null,
      assigned_by: assigned_by ? (assigned_by.id || assigned_by) : 'system',
      assigned_at: new Date().toISOString()
    };

    this._assignments.push(assignment);
    return assignment;
  }

  /**
   * Retrieves all role assignments for a given user.
   * @param {string} userId
   * @returns {Array<Object>}
   */
  getAssignments(userId) {
    return this._assignments.filter(a => a.user_id === userId);
  }

  /**
   * Clears assignments.
   */
  clear() {
    this._assignments = [];
  }
}

module.exports = RoleModel;
