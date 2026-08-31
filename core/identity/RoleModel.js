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
   * @param {Object} params
   * @param {string} params.user_id
   * @param {string} params.role
   * @param {'organization'|'brand'|'branch'|'global'} params.scope_type
   * @param {string} [params.scope_id]
   */
  assign({ user_id, role, scope_type = 'global', scope_id = null }) {
    if (!user_id || !role) {
      throw new Error('[RoleModel] "user_id" and "role" are required.');
    }

    const validRoles = Object.values(RoleModel.ROLES);
    if (!validRoles.includes(role)) {
      throw new Error(`[RoleModel] Invalid role "${role}". Allowed: ${validRoles.join(', ')}`);
    }

    const assignment = {
      user_id: user_id.trim(),
      role: role.trim(),
      scope_type,
      scope_id: scope_id ? scope_id.trim() : null,
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
