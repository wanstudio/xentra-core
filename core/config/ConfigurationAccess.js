/**
 * Xentra Core Configuration Access (C4)
 * Protects configuration read/write operations via RBAC and performs secret masking.
 */
const { AuthorizationService } = require('../identity');

class ConfigurationAccess {
  /**
   * Reads a configuration key with RBAC permission check and automatic secret masking.
   * 
   * @param {Object} params
   * @param {Object} params.scopeManager - ConfigurationScope instance
   * @param {string} params.key
   * @param {Object} params.identity - IdentityModel instance or user context
   * @param {Array<Object>} params.assignments - User role assignments
   * @param {Object} [params.target_context] - { organization_id, brand_id, branch_id }
   * @param {boolean} [params.reveal_secrets=false] - Request unmasked secret values
   * @returns {Object} Safe configuration payload { key, value, scope_type, is_secret, ... }
   */
  static read({
    scopeManager,
    key,
    identity,
    assignments = [],
    target_context = {},
    reveal_secrets = false
  }) {
    // 1. Resolve configuration entry
    const entry = scopeManager.resolve(key, target_context);
    if (!entry) return null;

    // 2. Secret reveal authorization
    let canReveal = false;
    if (entry.is_secret && reveal_secrets) {
      const auth = AuthorizationService.authorize({
        identity,
        assignments,
        required_permission: 'org:manage',
        target_context
      });
      canReveal = auth.allowed;
    }

    return entry.toSafeJSON(canReveal);
  }

  /**
   * Writes/Updates a configuration entry with RBAC enforcement.
   * 
   * @param {Object} params
   * @param {Object} params.scopeManager - ConfigurationScope instance
   * @param {Object} params.configPayload - ConfigurationModel parameters
   * @param {Object} params.identity - User identity
   * @param {Array<Object>} params.assignments - User role assignments
   * @returns {Object} Created/Updated ConfigurationModel
   */
  static write({
    scopeManager,
    configPayload,
    identity,
    assignments = []
  }) {
    const target_context = {
      organization_id: configPayload.scope_type === 'organization' ? configPayload.scope_id : null,
      brand_id: configPayload.scope_type === 'brand' ? configPayload.scope_id : null,
      branch_id: configPayload.scope_type === 'branch' ? configPayload.scope_id : null
    };

    // System and organization level require org:manage; brand level requires brand:manage; branch level requires branch:update
    let requiredPerm = 'org:manage';
    if (configPayload.scope_type === 'brand') requiredPerm = 'brand:manage';
    if (configPayload.scope_type === 'branch') requiredPerm = 'branch:update';

    const auth = AuthorizationService.authorize({
      identity,
      assignments,
      required_permission: requiredPerm,
      target_context
    });

    if (!auth.allowed) {
      const err = new Error(`[ConfigurationAccess] Access Denied: Cannot write configuration to scope "${configPayload.scope_type}". ${auth.reason}`);
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    return scopeManager.set(configPayload);
  }
}

module.exports = ConfigurationAccess;
