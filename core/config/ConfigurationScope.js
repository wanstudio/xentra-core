/**
 * Xentra Core Configuration Scope (C2)
 * Cascading hierarchy resolution: Branch Override -> Brand Override -> Organization -> System Default.
 */
const ConfigurationModel = require('./ConfigurationModel');

class ConfigurationScope {
  constructor() {
    this._entries = new Map(); // Composite key: `${key}::${scope_type}::${scope_id || 'root'}` -> ConfigurationModel
  }

  /**
   * Sets a configuration entry.
   * @param {Object} params - ConfigurationModel parameters
   */
  set(params) {
    const model = params instanceof ConfigurationModel ? params : new ConfigurationModel(params);
    const idKey = `${model.key}::${model.scope_type}::${model.scope_id || 'root'}`;
    this._entries.set(idKey, model);
    return model;
  }

  /**
   * Resolves configuration key using cascading fallback order:
   * 1. Branch level (if branch_id provided)
   * 2. Brand level (if brand_id provided)
   * 3. Organization level (if organization_id provided)
   * 4. System default (scope_type: 'system')
   * 
   * @param {string} key
   * @param {Object} [context] - { organization_id, brand_id, branch_id }
   * @returns {ConfigurationModel|null}
   */
  resolve(key, context = {}) {
    const k = key.trim();

    // 1. Branch Level
    if (context.branch_id) {
      const branchEntry = this._entries.get(`${k}::branch::${context.branch_id}`);
      if (branchEntry) return branchEntry;
    }

    // 2. Brand Level
    if (context.brand_id) {
      const brandEntry = this._entries.get(`${k}::brand::${context.brand_id}`);
      if (brandEntry) return brandEntry;
    }

    // 3. Organization Level
    if (context.organization_id) {
      const orgEntry = this._entries.get(`${k}::organization::${context.organization_id}`);
      if (orgEntry) return orgEntry;
    }

    // 4. System Default
    const systemEntry = this._entries.get(`${k}::system::root`);
    if (systemEntry) return systemEntry;

    return null;
  }

  /**
   * Resolves only the effective value of a key with fallback.
   * @param {string} key
   * @param {Object} [context]
   * @param {*} [defaultValue=null]
   * @returns {*}
   */
  getValue(key, context = {}, defaultValue = null) {
    const resolved = this.resolve(key, context);
    return resolved ? resolved.value : defaultValue;
  }

  /**
   * Clears internal configuration repository.
   */
  clear() {
    this._entries.clear();
  }
}

module.exports = ConfigurationScope;
