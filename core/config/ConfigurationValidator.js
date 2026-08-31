/**
 * Xentra Core Configuration Validator & Safe Defaults (C3)
 * Provides validation schemas, boundary checks, and system-wide default configurations.
 */
class ConfigurationValidator {
  /**
   * System-wide safe defaults catalog
   */
  static SAFE_DEFAULTS = {
    'platform.maintenance_mode': { type: 'boolean', value: false },
    'platform.default_currency': { type: 'string', value: 'IDR' },
    'platform.session_timeout_sec': { type: 'number', value: 86400 },
    'delivery.max_radius_km': { type: 'number', value: 15 },
    'delivery.free_distance_km': { type: 'number', value: 3 },
    'pos.auto_accept_order': { type: 'boolean', value: false },
    'kds.alert_audio_enabled': { type: 'boolean', value: true }
  };

  /**
   * Validates a configuration key-value pair against recognized schemas.
   * @param {string} key
   * @param {*} value
   * @param {string} type
   * @returns {{ valid: boolean, error?: string }}
   */
  static validate(key, value, type) {
    if (!key || typeof key !== 'string') {
      return { valid: false, error: 'Configuration key must be a non-empty string.' };
    }

    if (value === undefined) {
      return { valid: false, error: 'Configuration value cannot be undefined.' };
    }

    // Specific validation rules for numeric platform configurations
    if (type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Value for key "${key}" must be a valid number.` };
      }
      if (key.includes('radius') && value < 0) {
        return { valid: false, error: `Radius configuration "${key}" cannot be negative.` };
      }
      if (key.includes('timeout') && value <= 0) {
        return { valid: false, error: `Timeout configuration "${key}" must be greater than 0.` };
      }
    }

    return { valid: true };
  }

  /**
   * Applies system safe defaults to a ConfigurationScope instance.
   * @param {Object} configScope - ConfigurationScope instance
   */
  static applyDefaults(configScope) {
    for (const [key, def] of Object.entries(ConfigurationValidator.SAFE_DEFAULTS)) {
      configScope.set({
        key,
        value: def.value,
        type: def.type,
        scope_type: 'system',
        scope_id: null,
        description: 'Core platform safe default'
      });
    }
  }
}

module.exports = ConfigurationValidator;
