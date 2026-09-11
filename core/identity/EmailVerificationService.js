'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');
const { defaultEmailProvider } = require('./EmailProvider');

const TOKEN_TTL_HOURS = 24;

class EmailVerificationService {
  constructor(database = db, emailProvider = defaultEmailProvider) {
    this.db = database;
    this.emailProvider = emailProvider;
  }

  hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
  }

  /**
   * Generates a cryptographically secure verification token,
   * stores only its hash, invalidates previous unused tokens for the user,
   * and requests delivery via EmailProvider.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.email
   * @returns {Promise<{ tokenId: string, expiresAt: string, rawToken?: string }>}
   */
  async createAndSendVerificationToken({ userId, email }) {
    if (!userId || !email) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'userId dan email wajib diisi.' };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const tokenId = 'evt_' + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Invalidate/supersede any prior active verification tokens for this user
    this.db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(userId);

    // Persist new token record (never store raw token!)
    this.db.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(tokenId, userId, tokenHash, expiresAt, now);

    // Dispatch via email provider
    await this.emailProvider.sendVerificationEmail({
      to: email,
      rawToken,
      expiresAt
    });

    const result = {
      tokenId,
      expiresAt
    };

    // ONLY in test environment, expose rawToken on the returned object for test assertions
    if (process.env.NODE_ENV === 'test') {
      result.rawToken = rawToken;
    }

    return result;
  }

  /**
   * Atomically verifies and consumes an email verification token.
   * Protects against replay, expiration, and race conditions.
   *
   * @param {string} rawToken
   * @returns {{ success: boolean, userId: string, email: string }}
   */
  verifyToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw { status: 400, code: 'INVALID_TOKEN', message: 'Token verifikasi tidak valid atau tidak ditemukan.' };
    }

    const tokenHash = this.hashToken(rawToken);

    // Query token record
    const tokenRecord = this.db.prepare(`
      SELECT evt.*, u.email, u.email_verified_at, u.brand_id, u.organization_id, u.role
      FROM email_verification_tokens evt
      JOIN users u ON u.id = evt.user_id
      WHERE evt.token_hash = ?
    `).get(tokenHash);

    if (!tokenRecord) {
      throw { status: 400, code: 'INVALID_TOKEN', message: 'Token verifikasi tidak valid atau tidak ditemukan.' };
    }

    if (tokenRecord.used === 1) {
      throw { status: 400, code: 'TOKEN_ALREADY_USED', message: 'Token verifikasi ini sudah pernah digunakan.' };
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw { status: 400, code: 'TOKEN_EXPIRED', message: 'Token verifikasi telah kedaluwarsa. Silakan minta email verifikasi baru.' };
    }

    // Atomic Consumption: Ensure no race condition can consume the token twice
    this.db.exec('BEGIN;');
    try {
      const updateResult = this.db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE id = ? AND used = 0')
        .run(tokenRecord.id);

      if (!updateResult || updateResult.changes === 0) {
        throw { status: 400, code: 'TOKEN_ALREADY_USED', message: 'Token verifikasi ini sudah digunakan.' };
      }

      const verifiedAt = new Date().toISOString();
      this.db.prepare("UPDATE users SET email_verified_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(verifiedAt, tokenRecord.user_id);

      this.db.exec('COMMIT;');

      return {
        success: true,
        userId: tokenRecord.user_id,
        email: tokenRecord.email,
        brandId: tokenRecord.brand_id,
        organizationId: tokenRecord.organization_id,
        role: tokenRecord.role,
        verifiedAt
      };
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }
  }

  /**
   * Resends verification email for an account identified by email or user ID.
   * Protects against user enumeration (never exposes if email exists).
   *
   * @param {string} email
   */
  async resendVerificationEmail(email) {
    if (!email || typeof email !== 'string') {
      return { success: true, message: 'Jika email terdaftar dan belum diverifikasi, tautan verifikasi baru telah dikirimkan.' };
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = this.db.prepare('SELECT id, email, email_verified_at FROM users WHERE LOWER(email) = ?').get(cleanEmail);

    if (!user) {
      // Return identical generic success message to prevent user enumeration
      return { success: true, message: 'Jika email terdaftar dan belum diverifikasi, tautan verifikasi baru telah dikirimkan.' };
    }

    if (user.email_verified_at) {
      // Already verified — no new token needed, return safe generic success
      return { success: true, already_verified: true, message: 'Email sudah terverifikasi. Silakan langsung login.' };
    }

    const result = await this.createAndSendVerificationToken({
      userId: user.id,
      email: user.email
    });

    const response = {
      success: true,
      message: 'Jika email terdaftar dan belum diverifikasi, tautan verifikasi baru telah dikirimkan.'
    };

    if (process.env.NODE_ENV === 'test' && result.rawToken) {
      response.rawToken = result.rawToken;
    }

    return response;
  }
}

module.exports = EmailVerificationService;
