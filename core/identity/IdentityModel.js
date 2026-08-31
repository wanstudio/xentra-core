/**
 * Xentra Core Identity Model (B1)
 * Represents user identity, validation, and lifecycle state management.
 */
const crypto = require('crypto');

class IdentityModel {
  /**
   * Constructs an Identity instance.
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.username
   * @param {string} [params.email]
   * @param {string} [params.phone]
   * @param {string} [params.full_name]
   * @param {'active'|'suspended'|'pending'|'archived'} [params.status='pending']
   * @param {string} [params.created_at]
   */
  constructor({
    id,
    username,
    email = null,
    phone = null,
    full_name = '',
    status = 'pending',
    created_at = null
  }) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw new Error('[IdentityModel] "username" is required and must be a non-empty string.');
    }

    const validStatuses = ['pending', 'active', 'suspended', 'archived'];
    if (!validStatuses.includes(status)) {
      throw new Error(`[IdentityModel] Invalid status "${status}". Allowed: ${validStatuses.join(', ')}`);
    }

    this.id = id || `usr_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    this.username = username.trim().toLowerCase();
    this.email = email ? email.trim().toLowerCase() : null;
    this.phone = phone ? phone.trim() : null;
    this.full_name = full_name ? full_name.trim() : '';
    this.status = status;
    this.created_at = created_at || new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  /**
   * Activates a pending or suspended user.
   */
  activate() {
    if (this.status === 'archived') {
      throw new Error('[IdentityModel] Cannot activate an archived user.');
    }
    this.status = 'active';
    this.updated_at = new Date().toISOString();
    return this;
  }

  /**
   * Suspends an active user.
   */
  suspend(reason = '') {
    if (this.status === 'archived') {
      throw new Error('[IdentityModel] Cannot suspend an archived user.');
    }
    this.status = 'suspended';
    this.suspension_reason = reason;
    this.updated_at = new Date().toISOString();
    return this;
  }

  /**
   * Archives a user (Terminal lifecycle state).
   */
  archive() {
    this.status = 'archived';
    this.updated_at = new Date().toISOString();
    return this;
  }

  /**
   * Checks if user is currently in good standing.
   * @returns {boolean}
   */
  isActive() {
    return this.status === 'active';
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      phone: this.phone,
      full_name: this.full_name,
      status: this.status,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = IdentityModel;
