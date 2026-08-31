/**
 * Xentra Core Domain Identity (F1)
 * Represents unique domain identity and version metadata.
 */
class DomainIdentity {
  constructor({ name, version = '1.0.0', display_name = null, description = '' }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('[DomainIdentity] Domain "name" is required and must be a non-empty string.');
    }

    const cleanName = name.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(cleanName)) {
      throw new Error(`[DomainIdentity] Invalid domain name "${name}". Allowed characters: lowercase alphanumeric, hyphens, and underscores.`);
    }

    this.name = cleanName;
    this.version = String(version || '1.0.0').trim();
    this.display_name = display_name ? String(display_name).trim() : cleanName.toUpperCase();
    this.description = description ? String(description).trim() : '';

    Object.freeze(this);
  }

  toJSON() {
    return {
      name: this.name,
      version: this.version,
      display_name: this.display_name,
      description: this.description
    };
  }
}

module.exports = DomainIdentity;
