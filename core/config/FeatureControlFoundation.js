/**
 * Xentra Core Feature Control Foundation (C5)
 * Platform feature flag management with granular scope resolution (System -> Brand -> Branch).
 */
const ConfigurationScope = require('./ConfigurationScope');

class FeatureControlFoundation {
  /**
   * Standard Feature Flags Catalog
   */
  static FLAGS = {
    DYNAMIC_DELIVERY_FEE: 'feature.dynamic_delivery_fee',
    KDS_ALERT_AUDIO: 'feature.kds_alert_audio',
    AUTO_PRINT_RECEIPT: 'feature.auto_print_receipt',
    MIDTRANS_SNAP_POPUP: 'feature.midtrans_snap_popup'
  };

  /**
   * Constructs a FeatureControl instance.
   * @param {ConfigurationScope} [scopeManager]
   */
  constructor(scopeManager = new ConfigurationScope()) {
    this.scopeManager = scopeManager;
  }

  /**
   * Enables or disables a feature flag at a specific scope.
   * @param {string} flagKey
   * @param {boolean} enabled
   * @param {Object} [scope] - { scope_type: 'system'|'brand'|'branch', scope_id: string }
   */
  setFlag(flagKey, enabled, scope = { scope_type: 'system', scope_id: null }) {
    return this.scopeManager.set({
      key: flagKey.trim(),
      value: Boolean(enabled),
      type: 'boolean',
      scope_type: scope.scope_type || 'system',
      scope_id: scope.scope_id || null,
      description: `Feature toggle for ${flagKey}`
    });
  }

  /**
   * Evaluates if a feature flag is enabled for a target context (Branch -> Brand -> System).
   * @param {string} flagKey
   * @param {Object} [context] - { organization_id, brand_id, branch_id }
   * @param {boolean} [defaultState=false]
   * @returns {boolean}
   */
  isEnabled(flagKey, context = {}, defaultState = false) {
    const value = this.scopeManager.getValue(flagKey, context, defaultState);
    return Boolean(value);
  }
}

module.exports = FeatureControlFoundation;
