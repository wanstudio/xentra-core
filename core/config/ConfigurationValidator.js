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
   * Mandatory configurations that must never fallback to owner/code constants.
   */
  static MANDATORY_CONFIGS = [
    'branch.whatsapp_number'
  ];

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

    // Branch WhatsApp validation
    if (key === 'branch.whatsapp_number') {
      if (!value || typeof value !== 'string' || !value.trim()) {
        return { valid: false, error: 'Branch WhatsApp number is mandatory and cannot be empty.' };
      }
    }

    return { valid: true };
  }

  /**
   * Applies system safe defaults to a ConfigurationScope instance.
   * Note: Never creates Owner WhatsApp or operational fallback defaults.
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
        source: 'system_default',
        description: 'Core platform safe default'
      });
    }
  }

  /**
   * Validates environment secret presence without fallback.
   * @param {string} secretKey - e.g., 'WABLAS_API_KEY', 'MIDTRANS_SERVER_KEY'
   * @returns {string} The resolved secret value or throws explicit error.
   */
  static requireSecureEnvSecret(secretKey) {
    const val = process.env[secretKey];
    if (!val || !val.trim()) {
      throw new Error(`[ConfigurationValidator] Missing required infrastructure secret "${secretKey}". No hardcoded fallback allowed.`);
    }
    return val.trim();
  }
}

module.exports = ConfigurationValidator;
