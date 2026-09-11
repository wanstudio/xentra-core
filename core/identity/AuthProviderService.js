'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');

class AuthProviderService {
  constructor(database = db) {
    this.db = database;
  }

  /**
   * Finds a provider identity record by provider and provider-specific user identifier (e.g. Google sub).
   *
   * @param {string} provider Provider identifier, e.g. 'google'
   * @param {string} providerUserId Unique subject identifier from provider (e.g. sub)
   * @returns {Object|null} The provider record with attached user, or null if not found
   */
  findIdentity(provider, providerUserId) {
    if (!provider || !providerUserId) {
      return null;
    }

    const cleanProvider = String(provider).trim().toLowerCase();
    const cleanProviderUserId = String(providerUserId).trim();

    const row = this.db.prepare(`
      SELECT 
        uap.id as provider_link_id,
        uap.user_id,
        uap.provider,
        uap.provider_user_id,
        uap.email as provider_email,
        uap.metadata as provider_metadata,
        uap.linked_at,
        u.id,
        u.brand_id,
        u.organization_id,
        u.branch_id,
        u.username,
        u.email,
        u.full_name,
        u.role,
        u.status,
        u.email_verified_at,
        u.password_hash
      FROM user_auth_providers uap
      JOIN users u ON uap.user_id = u.id
      WHERE uap.provider = ? AND uap.provider_user_id = ?
    `).get(cleanProvider, cleanProviderUserId);

    if (!row) {
      return null;
    }

    return {
      providerLinkId: row.provider_link_id,
      userId: row.user_id,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      providerEmail: row.provider_email,
      providerMetadata: row.provider_metadata ? JSON.parse(row.provider_metadata) : null,
      linkedAt: row.linked_at,
      user: {
        id: row.id,
        brand_id: row.brand_id,
        organization_id: row.organization_id,
        branch_id: row.branch_id,
        username: row.username,
        email: row.email,
        full_name: row.full_name,
        role: row.role,
        status: row.status,
        email_verified: Boolean(row.email_verified_at),
        email_verified_at: row.email_verified_at
      }
    };
  }

  /**
   * Safely links an external provider identity (e.g. Google sub) to an existing Xentra user.
   *
   * Invariants:
   * - Target user MUST exist in `users`.
   * - Provider + provider_user_id MUST be unique.
   * - If already linked to the SAME user, returns existing link idempotently without error.
   * - If already linked to ANOTHER user, rejects with 409 PROVIDER_ALREADY_LINKED.
   * - Never overwrites or resets the user's password or authorization boundaries.
   *
   * @param {Object} params
   * @param {string} params.userId Target Xentra user ID
   * @param {string} params.provider Provider name, e.g. 'google'
   * @param {string} params.providerUserId Immutable provider subject ID (e.g. sub)
   * @param {string} [params.email] Optional verified email associated with provider account
   * @param {Object} [params.metadata] Optional profile metadata
   * @returns {Object} Result of link operation
   */
  linkProvider({ userId, provider, providerUserId, email = null, metadata = null }) {
    if (!userId || !provider || !providerUserId) {
      throw {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'userId, provider, and providerUserId are required.'
      };
    }

    const cleanUserId = String(userId).trim();
    const cleanProvider = String(provider).trim().toLowerCase();
    const cleanProviderUserId = String(providerUserId).trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;

    // Verify target user exists
    const user = this.db.prepare('SELECT id, status FROM users WHERE id = ?').get(cleanUserId);
    if (!user) {
      throw {
        status: 404,
        code: 'USER_NOT_FOUND',
        message: 'Target user does not exist.'
      };
    }

    // Check if this provider identity is already linked to anyone
    const existing = this.db.prepare(
      'SELECT id, user_id, provider, provider_user_id FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?'
    ).get(cleanProvider, cleanProviderUserId);

    if (existing) {
      if (existing.user_id === cleanUserId) {
        // Idempotent: already linked to the requested user
        return {
          success: true,
          linked: false,
          alreadyLinked: true,
          providerLinkId: existing.id,
          userId: cleanUserId,
          provider: cleanProvider,
          providerUserId: cleanProviderUserId
        };
      } else {
        // Conflict: linked to a different Xentra user!
        throw {
          status: 409,
          code: 'PROVIDER_ALREADY_LINKED',
          message: 'Akun provider ini telah terhubung ke akun pengguna Xentra lain.'
        };
      }
    }

    const id = 'uap_' + crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    this.db.prepare(`
      INSERT INTO user_auth_providers (
        id, user_id, provider, provider_user_id, email, metadata, linked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanUserId,
      cleanProvider,
      cleanProviderUserId,
      cleanEmail,
      metadataStr,
      now,
      now,
      now
    );

    return {
      success: true,
      linked: true,
      alreadyLinked: false,
      providerLinkId: id,
      userId: cleanUserId,
      provider: cleanProvider,
      providerUserId: cleanProviderUserId,
      email: cleanEmail
    };
  }

  /**
   * Lists all linked providers for a given user.
   *
   * @param {string} userId
   * @returns {Array<Object>} List of linked provider summaries
   */
  listLinkedProviders(userId) {
    if (!userId) return [];

    const rows = this.db.prepare(`
      SELECT id, provider, provider_user_id, email, metadata, linked_at, created_at
      FROM user_auth_providers
      WHERE user_id = ?
      ORDER BY created_at ASC
    `).all(String(userId).trim());

    return rows.map(r => ({
      id: r.id,
      provider: r.provider,
      providerUserId: r.provider_user_id,
      email: r.email,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      linkedAt: r.linked_at
    }));
  }

  /**
   * Safely unlinks a provider from a user, ensuring the user is not left locked out if they have no password.
   *
   * @param {string} userId
   * @param {string} provider
   * @returns {{ success: boolean }}
   */
  unlinkProvider(userId, provider) {
    if (!userId || !provider) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'userId and provider are required.' };
    }

    const cleanUserId = String(userId).trim();
    const cleanProvider = String(provider).trim().toLowerCase();

    // Ensure user exists and has a fallback authentication method (e.g. password_hash or other linked providers)
    const user = this.db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(cleanUserId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }

    const otherProviders = this.db.prepare(
      'SELECT COUNT(*) as count FROM user_auth_providers WHERE user_id = ? AND provider != ?'
    ).get(cleanUserId, cleanProvider);

    const hasPassword = Boolean(user.password_hash);
    const hasOtherProvider = otherProviders && otherProviders.count > 0;

    if (!hasPassword && !hasOtherProvider) {
      throw {
        status: 400,
        code: 'CANNOT_UNLINK_ONLY_AUTH_METHOD',
        message: 'Tidak dapat memutuskan satu-satunya metode login yang aktif.'
      };
    }

    const result = this.db.prepare(
      'DELETE FROM user_auth_providers WHERE user_id = ? AND provider = ?'
    ).run(cleanUserId, cleanProvider);

    return {
      success: true,
      unlinked: result.changes > 0
    };
  }
}

module.exports = AuthProviderService;
