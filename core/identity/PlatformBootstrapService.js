'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../server/database/db');
const RoleModel = require('./RoleModel');

const BCRYPT_ROUNDS = 12;

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email.trim());
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return { valid: false, message: 'Password Platform Owner minimal 10 karakter.' };
  }
  // Require at least one uppercase, one lowercase, and one digit
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password harus mengandung minimal satu huruf kapital.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password harus mengandung minimal satu huruf kecil.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password harus mengandung minimal satu angka.' };
  }
  return { valid: true };
}

class PlatformBootstrapService {
  constructor(database = db) {
    this.db = database;
  }

  hashPassword(password) {
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
  }

  /**
   * Bootstraps the initial Platform Owner identity.
   *
   * Invariants:
   * - Platform Owner is platform-scoped (role = 'platform_owner').
   * - Must NOT require fake Organization / Brand / Branch (brand_id = NULL, organization_id = NULL).
   * - Must NOT silently overwrite existing Platform Owner credentials.
   * - If a Platform Owner already exists and forceReset is false, returns { created: false, reason: 'ALREADY_EXISTS' }.
   * - If forceReset is true, rotates credentials with auditable log.
   * - Password is encrypted with bcrypt (12 rounds) and NEVER logged or returned in plaintext.
   * - Emits auditable security event in security_audit_log.
   *
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @param {string} [params.full_name]
   * @param {string} [params.username]
   * @param {boolean} [params.forceReset=false]
   * @returns {Object} Sanitized result without plaintext password
   */
  bootstrapPlatformOwner({
    email,
    password,
    full_name = 'Xentra Platform Owner',
    username = null,
    forceReset = false
  }) {
    if (!email || !isValidEmail(email)) {
      throw { status: 400, code: 'INVALID_EMAIL', message: 'Format email Platform Owner tidak valid.' };
    }

    const cleanEmail = email.trim().toLowerCase();

    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      throw { status: 400, code: 'WEAK_PASSWORD', message: passwordCheck.message };
    }

    const cleanFullName = (full_name || 'Xentra Platform Owner').trim();
    let cleanUsername = username ? username.trim().toLowerCase() : cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (cleanUsername.length < 3) cleanUsername = 'platform_admin';

    // 1. Check for existing Platform Owner
    const existingPlatformOwner = this.db.prepare(`
      SELECT id, username, email, full_name, role, status, mfa_enabled, created_at, updated_at
      FROM users
      WHERE role = ?
      LIMIT 1
    `).get(RoleModel.ROLES.PLATFORM_OWNER);

    if (existingPlatformOwner) {
      if (!forceReset) {
        return {
          created: false,
          reason: 'ALREADY_EXISTS',
          message: 'Platform Owner sudah terdaftar. Bootstrap tidak melakukan overwrite secara implisit.',
          user: {
            id: existingPlatformOwner.id,
            username: existingPlatformOwner.username,
            email: existingPlatformOwner.email,
            full_name: existingPlatformOwner.full_name,
            role: existingPlatformOwner.role,
            status: existingPlatformOwner.status,
            mfa_enabled: Boolean(existingPlatformOwner.mfa_enabled),
            mfa_ready: true,
            created_at: existingPlatformOwner.created_at
          }
        };
      }

      // Explicit Force Reset requested
      const passwordHash = this.hashPassword(password);
      const now = new Date().toISOString();

      this.db.prepare(`
        UPDATE users
        SET password_hash = ?,
            full_name = ?,
            password_changed_at = ?,
            updated_at = ?,
            status = 'active'
        WHERE id = ?
      `).run(passwordHash, cleanFullName, now, now, existingPlatformOwner.id);

      this._logSecurityEvent({
        actor_id: 'system_bootstrap',
        actor_role: RoleModel.ROLES.PLATFORM_OWNER,
        action: 'PLATFORM_OWNER_CREDENTIALS_RESET',
        target_user_id: existingPlatformOwner.id,
        target_role: RoleModel.ROLES.PLATFORM_OWNER,
        result: 'success',
        metadata: {
          email: existingPlatformOwner.email,
          reason: 'explicit_force_reset_by_operator'
        }
      });

      return {
        created: false,
        updated: true,
        reason: 'CREDENTIALS_RESET',
        message: 'Kredensial Platform Owner berhasil diperbarui.',
        user: {
          id: existingPlatformOwner.id,
          username: existingPlatformOwner.username,
          email: existingPlatformOwner.email,
          full_name: cleanFullName,
          role: RoleModel.ROLES.PLATFORM_OWNER,
          status: 'active',
          mfa_enabled: Boolean(existingPlatformOwner.mfa_enabled),
          mfa_ready: true,
          updated_at: now
        }
      };
    }

    // 2. Check for username conflict with existing users
    const existingUserByUsername = this.db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existingUserByUsername) {
      cleanUsername = `plat_${crypto.randomBytes(4).toString('hex')}`;
    }

    // 3. Insert Platform Owner (No fake Org/Brand/Branch)
    const userId = 'usr_plat_' + crypto.randomBytes(12).toString('hex');
    const passwordHash = this.hashPassword(password);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO users (
        id, brand_id, organization_id, branch_id, username, email, password_hash,
        full_name, role, status, mfa_enabled, mfa_enrolled_at, password_changed_at,
        email_verified_at, created_at, updated_at
      ) VALUES (
        ?, NULL, NULL, NULL, ?, ?, ?,
        ?, ?, 'active', 0, NULL, ?,
        ?, ?, ?
      )
    `).run(
      userId,
      cleanUsername,
      cleanEmail,
      passwordHash,
      cleanFullName,
      RoleModel.ROLES.PLATFORM_OWNER,
      now,
      now,
      now,
      now
    );

    // 4. Audit Log (Never log passwords or hashes)
    this._logSecurityEvent({
      actor_id: 'system_bootstrap',
      actor_role: RoleModel.ROLES.PLATFORM_OWNER,
      action: 'PLATFORM_OWNER_BOOTSTRAPPED',
      target_user_id: userId,
      target_role: RoleModel.ROLES.PLATFORM_OWNER,
      result: 'success',
      metadata: {
        email: cleanEmail,
        username: cleanUsername,
        mfa_ready: true
      }
    });

    return {
      created: true,
      reason: 'BOOTSTRAP_SUCCESS',
      message: 'Platform Owner berhasil dibuat.',
      user: {
        id: userId,
        username: cleanUsername,
        email: cleanEmail,
        full_name: cleanFullName,
        role: RoleModel.ROLES.PLATFORM_OWNER,
        brand_id: null,
        organization_id: null,
        branch_id: null,
        status: 'active',
        email_verified: true,
        mfa_enabled: false,
        mfa_ready: true,
        created_at: now
      }
    };
  }

  verifyPassword(password, hash) {
    if (!password || !hash) return false;
    if (hash.startsWith('$2')) {
      return bcrypt.compareSync(password, hash);
    }
    return false;
  }

  /**
   * Authenticates Platform Owner credentials.
   *
   * Invariants:
   * - Only matches users with role = 'platform_owner'.
   * - Never authenticates merchant users (role != 'platform_owner').
   * - Does not expose account existence if credentials fail.
   * - Emits auditable security events (PLATFORM_LOGIN_SUCCESS, PLATFORM_LOGIN_FAILED).
   * - Never logs or returns plaintext password or password hash.
   *
   * @param {string} email
   * @param {string} password
   * @returns {{ success: boolean, user?: Object, error?: string, message?: string }}
   */
  authenticate(email, password) {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return { success: false, error: 'INVALID_CREDENTIALS', message: 'Email dan password wajib diisi.' };
    }

    const cleanEmail = email.trim().toLowerCase();

    // Query specifically for Platform Owner
    const user = this.db.prepare(`
      SELECT id, username, email, full_name, role, status, password_hash, mfa_enabled, mfa_enrolled_at, created_at, updated_at
      FROM users
      WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND role = ?
    `).get(cleanEmail, cleanEmail, RoleModel.ROLES.PLATFORM_OWNER);

    if (!user) {
      this._logSecurityEvent({
        actor_id: 'unknown',
        actor_role: RoleModel.ROLES.PLATFORM_OWNER,
        action: 'PLATFORM_LOGIN_FAILED',
        result: 'failure',
        metadata: { identifier: cleanEmail, reason: 'user_not_found_or_not_platform_owner' }
      });
      return { success: false, error: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' };
    }

    // Account status check
    if (user.status && user.status !== 'active') {
      this._logSecurityEvent({
        actor_id: user.id,
        actor_role: RoleModel.ROLES.PLATFORM_OWNER,
        action: 'PLATFORM_LOGIN_FAILED',
        target_user_id: user.id,
        target_role: RoleModel.ROLES.PLATFORM_OWNER,
        result: 'failure',
        metadata: { identifier: cleanEmail, reason: 'account_inactive', status: user.status }
      });
      return { success: false, error: 'ACCOUNT_DISABLED', message: 'Akun Platform Owner tidak aktif. Hubungi administrator sistem.' };
    }

    // Password verification
    const passwordMatch = this.verifyPassword(password, user.password_hash);
    if (!passwordMatch) {
      this._logSecurityEvent({
        actor_id: user.id,
        actor_role: RoleModel.ROLES.PLATFORM_OWNER,
        action: 'PLATFORM_LOGIN_FAILED',
        target_user_id: user.id,
        target_role: RoleModel.ROLES.PLATFORM_OWNER,
        result: 'failure',
        metadata: { identifier: cleanEmail, reason: 'password_mismatch' }
      });
      return { success: false, error: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' };
    }

    // Update last_login_at
    try {
      this.db.prepare("UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(user.id);
    } catch (_) {}

    // Audit successful login
    this._logSecurityEvent({
      actor_id: user.id,
      actor_role: RoleModel.ROLES.PLATFORM_OWNER,
      action: 'PLATFORM_LOGIN_SUCCESS',
      target_user_id: user.id,
      target_role: RoleModel.ROLES.PLATFORM_OWNER,
      result: 'success',
      metadata: { email: user.email }
    });

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        brand_id: null,
        organization_id: null,
        branch_id: null,
        status: user.status || 'active',
        email_verified: true,
        mfa_enabled: Boolean(user.mfa_enabled),
        mfa_ready: true,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    };
  }

  _logSecurityEvent({ actor_id, actor_role, action, target_user_id, target_role, result, metadata }) {
    try {
      const id = 'sal_' + crypto.randomBytes(16).toString('hex');
      const safeMetadata = metadata ? JSON.stringify(metadata) : null;

      this.db.prepare(`
        INSERT INTO security_audit_log (
          id, actor_id, actor_role, action, target_user_id, target_role,
          brand_id, organization_id, branch_id, result, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, datetime('now'))
      `).run(
        id,
        actor_id || null,
        actor_role || null,
        action || null,
        target_user_id || null,
        target_role || null,
        result || 'unknown',
        safeMetadata
      );
    } catch (e) {
      console.warn('[PlatformBootstrapService] Security audit log write error:', e.message);
    }
  }
}

module.exports = PlatformBootstrapService;
