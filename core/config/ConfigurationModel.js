/**
 * Xentra Core Configuration Model (C1)
 * Represents a configuration entry with typed values, scopes, and secret flags.
 */
class ConfigurationModel {
  /**
   * Allowed Types: 'string' | 'number' | 'boolean' | 'json'
   * Allowed Scopes: 'system' | 'organization' | 'brand' | 'branch'
   */
  constructor({
    key,
    value,
    type = 'string',
    scope_type = 'system',
    scope_id = null,
    is_secret = false,
    description = ''
  }) {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new Error('[ConfigurationModel] "key" is required and must be a non-empty string.');
    }

    const validTypes = ['string', 'number', 'boolean', 'json'];
    if (!validTypes.includes(type)) {
      throw new Error(`[ConfigurationModel] Invalid type "${type}". Allowed: ${validTypes.join(', ')}`);
    }

    const validScopes = ['system', 'organization', 'brand', 'branch'];
    if (!validScopes.includes(scope_type)) {
      throw new Error(`[ConfigurationModel] Invalid scope_type "${scope_type}". Allowed: ${validScopes.join(', ')}`);
    }

    this.key = key.trim();
    this.type = type;
    this.scope_type = scope_type;
    this.scope_id = scope_id ? String(scope_id).trim() : null;
    this.is_secret = Boolean(is_secret);
    this.description = description ? String(description).trim() : '';
    this.value = ConfigurationModel.castValue(value, type);
    this.updated_at = new Date().toISOString();
  }

  /**
   * Casts and validates raw value to specified type.
   */
  static castValue(raw, type) {
    if (raw === undefined || raw === null) return null;

    switch (type) {
      case 'string':
        return String(raw);
      case 'number': {
        const num = Number(raw);
        if (isNaN(num)) throw new Error(`[ConfigurationModel] Cannot cast "${raw}" to number.`);
        return num;
      }
      case 'boolean':
        if (typeof raw === 'boolean') return raw;
        if (raw === 'true' || raw === 1 || raw === '1') return true;
        if (raw === 'false' || raw === 0 || raw === '0') return false;
        return Boolean(raw);
      case 'json':
        if (typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw);
        } catch (e) {
          throw new Error(`[ConfigurationModel] Invalid JSON value: ${e.message}`);
        }
      default:
        return raw;
    }
  }

  /**
   * Returns a safe representation (masking secret values if requested).
   */
  toSafeJSON(revealSecret = false) {
    return {
      key: this.key,
      value: this.is_secret && !revealSecret ? '********' : this.value,
      type: this.type,
      scope_type: this.scope_type,
      scope_id: this.scope_id,
      is_secret: this.is_secret,
      description: this.description,
      updated_at: this.updated_at
    };
  }
}

module.exports = ConfigurationModel;
