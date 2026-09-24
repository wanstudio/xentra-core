const WorkforceRepository = require('../data/repositories/WorkforceRepository');
const WorkforceMembershipService = require('./WorkforceMembershipService');

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

class WorkforceService {
  constructor(repository = new WorkforceRepository()) {
    this.repository = repository instanceof WorkforceRepository ? repository : new WorkforceRepository(repository);
    this.memberships = new WorkforceMembershipService(this.repository);
  }

  // ==================== PASSWORD HASHING ====================

  hashPassword(password) {
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
  }

  verifyPassword(password, hash) {
    if (!password || !hash) return false;
    // bcrypt verification
    if (hash.startsWith('$2')) {
      return bcrypt.compareSync(password, hash);
    }
    // Legacy SHA-256 fallback for migration
    const crypto = require('crypto');
    const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
    return sha256Hash === hash;
  }

  isLegacyHash(hash) {
    return hash && !hash.startsWith('$2');
  }

  // ==================== USER LIFECYCLE ====================

  createUser({ brand_id, organization_id, branch_id, username, email, password, full_name, role, created_by }) {
    if (!brand_id || !organization_id || !username || !password || !role) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'brand_id, organization_id, username, password, and role are required.' };
    }

    const allowedRoles = ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    if (!allowedRoles.includes(role)) {
      throw { status: 400, code: 'INVALID_ROLE', message: `Role must be one of: ${allowedRoles.join(', ')}` };
    }

    if (!/^[a-z0-9._-]+$/.test(username)) {
      throw { status: 400, code: 'INVALID_USERNAME', message: 'Username must contain only lowercase letters, numbers, dots, hyphens, and underscores.' };
    }

    const existing = this.repository.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      throw { status: 409, code: 'USERNAME_EXISTS', message: 'Username already exists.' };
    }

    if (branch_id) {
      const branch = this.repository.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, brand_id);
      if (!branch) {
        throw { status: 400, code: 'INVALID_BRANCH', message: 'Branch does not belong to this brand.' };
      }
    }

    const id = 'usr_' + crypto.randomBytes(16).toString('hex');
    const password_hash = this.hashPassword(password);
    const now = new Date().toISOString();

    this.repository.prepare(`
      INSERT INTO users (
        id, brand_id, organization_id, branch_id, username, email, password_hash,
        full_name, role, status, password_changed_at, email_verified_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      id, brand_id, organization_id, branch_id || null, username, email || null,
      password_hash, full_name || null, role, now, now, now, now
    );

    this.memberships.ensureMembership({
      userId: id,
      organizationId: organization_id,
      brandId: brand_id,
      branchId: branch_id || null,
      role,
      status: 'active'
    });

    return {
      id, username, email, full_name, role,
      branch_id: branch_id || null,
      organization_id,
      brand_id,
      status: 'active',
      email_verified: true
    };
  }



  getUser(userId, brandId) {
    const user = this.repository.prepare(`
      SELECT
        u.id,
        COALESCE(wm.brand_id, u.brand_id) AS brand_id,
        COALESCE(wm.organization_id, u.organization_id) AS organization_id,
        COALESCE(wm.branch_id, u.branch_id) AS branch_id,
        u.username, u.email, u.full_name,
        COALESCE(wm.role, u.role) AS role,
        u.status,
        COALESCE(wm.status, u.status, 'active') AS membership_status,
        wm.id AS membership_id,
        u.created_at, u.updated_at, u.last_login_at, u.password_changed_at
      FROM users u
      LEFT JOIN workforce_memberships wm
        ON wm.user_id = u.id AND wm.brand_id = ?
      WHERE u.id = ?
        AND (
          wm.id IS NOT NULL
          OR u.brand_id = ?
        )
      LIMIT 1
    `).get(brandId, userId, brandId);

    if (!user) throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };

    // Self-heal legacy rows created after the schema migration. Existing users
    // created by older code may have only users.brand_id/role; materialize that
    // relationship into workforce_memberships on first access.
    if (!user.membership_id && user.brand_id && user.organization_id && user.role && user.role !== 'platform_owner') {
      this.memberships.ensureMembership({
        userId: user.id,
        organizationId: user.organization_id,
        brandId: user.brand_id,
        branchId: user.branch_id || null,
        role: user.role,
        status: user.status || 'active'
      });
      return this.getUser(userId, brandId);
    }

    if (user.membership_status && user.membership_status !== 'active') {
      throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'Workforce membership is not active.' };
    }
    return user;
  }



  listUsers(brandId, { role, branch_id, status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        u.id,
        COALESCE(wm.brand_id, u.brand_id) AS brand_id,
        COALESCE(wm.organization_id, u.organization_id) AS organization_id,
        COALESCE(wm.branch_id, u.branch_id) AS branch_id,
        u.username, u.email, u.full_name,
        COALESCE(wm.role, u.role) AS role,
        COALESCE(wm.status, u.status, 'active') AS status,
        u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workforce_memberships wm
        ON wm.user_id = u.id AND wm.brand_id = ?
      WHERE (
        wm.id IS NOT NULL
        OR u.brand_id = ?
      )
    `;
    const params = [brandId, brandId];

    if (role) {
      query += ' AND COALESCE(wm.role, u.role) = ?';
      params.push(role);
    }
    if (branch_id) {
      query += ' AND COALESCE(wm.branch_id, u.branch_id) = ?';
      params.push(branch_id);
    }
    if (status) {
      query += ' AND COALESCE(wm.status, u.status, \'active\') = ?';
      params.push(status);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.repository.prepare(query).all(...params);
  }



  updateUser(userId, brandId, updates, { actor_id, actor_role } = {}) {
    const user = this.getUser(userId, brandId);

    if (actor_role === 'brand_manager' && user.role !== 'cashier') {
      throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only update Cashier profiles.' };
    }

    const allowedFields = ['full_name', 'email'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates || {})) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      throw { status: 400, code: 'NO_VALID_FIELDS', message: 'No valid fields to update.' };
    }

    setClauses.push('updated_at = datetime(\'now\')');
    params.push(userId);
    this.repository.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    return this.getUser(userId, brandId);
  }



  disableUser(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    if (target.role === 'owner') {
      const ownerCount = this.memberships.countActiveOwners(brandId);
      if (ownerCount <= 1) {
        throw { status: 400, code: 'LAST_OWNER_PROTECTED', message: 'Cannot disable the last Owner account.' };
      }
    }

    if (actor_role === 'branch_manager' || actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only disable Cashier accounts.' };
      }
      if (actor_role === 'branch_manager' && target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only disable Cashier accounts within their branch.' };
      }
    }

    this.memberships.setStatus(targetUserId, brandId, 'disabled');
    this.invalidateUserSessions(targetUserId);

    return { ...target, status: 'disabled', membership_status: 'disabled' };
  }



  enableUser(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    if (actor_role === 'branch_manager' || actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only enable Cashier accounts.' };
      }
      if (actor_role === 'branch_manager' && target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only enable Cashier accounts within their branch.' };
      }
    }

    this.memberships.setStatus(targetUserId, brandId, 'active');
    if (global.TokenSessionStore && global.TokenSessionStore.revokedUserIds) {
      global.TokenSessionStore.revokedUserIds.delete(targetUserId);
    }

    return { ...target, status: 'active', membership_status: 'active' };
  }



  deleteUser(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    if (actor_role !== 'owner') {
      throw { status: 403, code: 'FORBIDDEN_DELETE_MEMBER', message: 'Only Owner can delete team members.' };
    }

    const target = this.getUser(targetUserId, brandId);
    if (actor_id && targetUserId === actor_id) {
      throw { status: 400, code: 'SELF_DELETE_PROTECTED', message: 'Anda tidak dapat menghapus akun Anda sendiri.' };
    }

    if (target.role === 'owner' && this.memberships.countActiveOwners(brandId) <= 1) {
      throw { status: 400, code: 'LAST_OWNER_PROTECTED', message: 'Tidak dapat menghapus Owner terakhir.' };
    }

    this.memberships.removeMembership(targetUserId, brandId);
    this.invalidateUserSessions(targetUserId);

    // The User remains as the authentication identity so memberships in other
    // businesses (and future Customer identity) are never destroyed.
    return {
      success: true,
      deleted_user_id: targetUserId,
      deleted_user_name: target.full_name,
      role: target.role
    };
  }



  changeUserRole(targetUserId, brandId, newRole, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    if (actor_role !== 'owner') {
      throw { status: 403, code: 'FORBIDDEN_ROLE_CHANGE', message: 'Only Owner can change user roles.' };
    }

    const allowedRoles = ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    if (!allowedRoles.includes(newRole)) {
      throw { status: 400, code: 'INVALID_ROLE', message: `Role must be one of: ${allowedRoles.join(', ')}` };
    }

    if (target.role === 'owner' && newRole !== 'owner' && this.memberships.countActiveOwners(brandId) <= 1) {
      throw { status: 400, code: 'LAST_OWNER_PROTECTED', message: 'Cannot demote the last Owner account.' };
    }

    this.memberships.updateRoleScope(targetUserId, brandId, {
      role: newRole,
      branchId: target.branch_id
    });
    this.invalidateUserSessions(targetUserId);

    return { ...target, role: newRole };
  }



  changeUserScope(targetUserId, brandId, newBranchId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    if (actor_role === 'brand_manager' || actor_role === 'branch_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only change scope of Cashier accounts.' };
      }
      if (actor_role === 'branch_manager') {
        if (target.branch_id !== actor_branch_id) {
          throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only change scope of Cashier accounts within their branch.' };
        }
        if (newBranchId && newBranchId !== actor_branch_id) {
          throw { status: 403, code: 'FORBIDDEN_SCOPE_ESCALATION', message: 'Managers cannot assign Cashier to a different branch.' };
        }
      }
    }

    if (newBranchId) {
      const branch = this.repository.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(newBranchId, brandId);
      if (!branch) {
        throw { status: 400, code: 'INVALID_BRANCH', message: 'Branch does not belong to this brand.' };
      }
    }

    this.memberships.updateRoleScope(targetUserId, brandId, { branchId: newBranchId || null });
    this.invalidateUserSessions(targetUserId);

    return { ...target, branch_id: newBranchId || null };
  }

  // ==================== PASSWORD MANAGEMENT ====================

  // ==================== PASSWORD MANAGEMENT ====================

  selfChangePassword(userId, brandId, currentPassword, newPassword, confirmPassword) {
    if (newPassword !== confirmPassword) {
      throw { status: 400, code: 'PASSWORD_MISMATCH', message: 'New password and confirmation do not match.' };
    }

    if (newPassword.length < 8) {
      throw { status: 400, code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.' };
    }

    // Membership determines access to the requested business; password remains
    // a property of the Xentra User identity and is therefore global.
    this.getUser(userId, brandId);
    const user = this.repository.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }

    // Guard: Account without password credential cannot use self password change
    if (!user.password_hash) {
      throw { status: 400, code: 'NO_PASSWORD_SET', message: 'Akun ini belum memiliki password. Gunakan alur reset password untuk membuat password.' };
    }

    // Verify current password
    if (!this.verifyPassword(currentPassword, user.password_hash)) {
      throw { status: 401, code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' };
    }

    // Hash new password
    const newHash = this.hashPassword(newPassword);

    // Update password
    this.repository.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
      .run(newHash, userId);

    return { success: true };
  }

  adminResetPassword(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const targetContext = this.getUser(targetUserId, brandId);
    const target = this.repository.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'Target user not found.' };
    }

    // Authorization checks
    if (actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only reset Cashier passwords.' };
      }
    }

    if (actor_role === 'branch_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only reset Cashier passwords.' };
      }
      if (target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only reset Cashier passwords within their branch.' };
      }
    }

    if (actor_role === 'cashier') {
      throw { status: 403, code: 'FORBIDDEN_PASSWORD_RESET', message: 'Cashiers cannot reset other users passwords.' };
    }

    // Generate one-time reset token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = 'prt_' + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    // Invalidate any existing unused tokens for this user
    this.repository.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(targetUserId);

    // Store new token
    this.repository.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used, created_by, created_at)
      VALUES (?, ?, ?, ?, 0, ?, datetime('now'))
    `).run(tokenId, targetUserId, tokenHash, expiresAt, actor_id);

    // Invalidate all existing sessions for the target user
    this.invalidateUserSessions(targetUserId);

    return { reset_token: rawToken, expires_at: expiresAt };
  }

  completePasswordReset(rawToken, newPassword) {
    if (!rawToken || !newPassword) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Token and new password are required.' };
    }

    if (newPassword.length < 8) {
      throw { status: 400, code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.' };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Execute token consumption and credential update in a single atomic transaction
    this.repository.exec('BEGIN TRANSACTION;');
    try {
      // Re-validate/load token record inside transaction
      const tokenRecord = this.repository.prepare(`
        SELECT prt.*, u.brand_id 
        FROM password_reset_tokens prt
        JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = ? AND prt.used = 0
      `).get(tokenHash);

      if (!tokenRecord) {
        throw { status: 400, code: 'INVALID_TOKEN', message: 'Invalid or already used reset token.' };
      }

      if (new Date(tokenRecord.expires_at) < new Date()) {
        throw { status: 400, code: 'TOKEN_EXPIRED', message: 'Reset token has expired.' };
      }

      // Mark token as used atomically (ensuring status transition succeeds)
      const updateTokenRes = this.repository.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ? AND used = 0').run(tokenRecord.id);
      if (updateTokenRes.changes === 0) {
        throw { status: 400, code: 'INVALID_TOKEN', message: 'Invalid or already used reset token.' };
      }

      // Update password
      const newHash = this.hashPassword(newPassword);
      this.repository.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
        .run(newHash, tokenRecord.user_id);

      this.repository.exec('COMMIT;');

      // Invalidate existing sessions ONLY after transaction commit succeeds
      this.invalidateUserSessions(tokenRecord.user_id);

      return { success: true, user_id: tokenRecord.user_id, brand_id: tokenRecord.brand_id };
    } catch (err) {
      try {
        this.repository.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    }
  }

  // ==================== SESSION MANAGEMENT ====================

  invalidateUserSessions(userId) {
    // Mark all tokens for this user as requiring re-authentication
    // Since we use in-memory sessions, we need to add a revocation mechanism
    // This will be handled by the TokenSessionStore revocation list
    if (global.TokenSessionStore && global.TokenSessionStore.revokeUserSessions) {
      global.TokenSessionStore.revokeUserSessions(userId);
    }
  }

  // ==================== AUTHENTICATION ====================

  authenticate(username, password, brandId) {
    let user = this.repository.prepare(`
      SELECT
        u.*,
        wm.id AS membership_id,
        COALESCE(wm.brand_id, u.brand_id) AS membership_brand_id,
        COALESCE(wm.organization_id, u.organization_id) AS membership_organization_id,
        COALESCE(wm.branch_id, u.branch_id) AS membership_branch_id,
        COALESCE(wm.role, u.role) AS membership_role,
        COALESCE(wm.status, u.status, 'active') AS membership_status
      FROM users u
      LEFT JOIN workforce_memberships wm
        ON wm.user_id = u.id AND wm.brand_id = ?
      WHERE (u.username = ? OR u.email = ?)
        AND (
          wm.id IS NOT NULL
          OR u.brand_id = ?
          OR (u.brand_id IS NULL AND ? IS NULL)
        )
      LIMIT 1
    `).get(brandId, username, username, brandId, brandId);

    if (!user) return { success: false, error: 'INVALID_CREDENTIALS' };

    if (user.role === 'platform_owner') {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    if (user.status === 'disabled') {
      return { success: false, error: 'ACCOUNT_DISABLED', message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.' };
    }

    if (user.membership_status && user.membership_status !== 'active') {
      return { success: false, error: 'ACCOUNT_DISABLED', message: 'Akun Anda tidak aktif pada bisnis ini.' };
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return { success: false, error: 'ACCOUNT_LOCKED', message: 'Akun Anda terkunci sementara. Coba lagi nanti.' };
    }

    if (!user.password_hash) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lockUntil = attempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
      this.repository.prepare(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).run(attempts, lockUntil, user.id);
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    if (!this.verifyPassword(password, user.password_hash)) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lockUntil = attempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
      this.repository.prepare(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).run(attempts, lockUntil, user.id);
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    this.repository.prepare(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?'
    ).run(user.id);

    if (this.isLegacyHash(user.password_hash)) {
      const newHash = this.hashPassword(password);
      this.repository.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\') WHERE id = ?')
        .run(newHash, user.id);
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.membership_role || user.role,
        branch_id: user.membership_branch_id || null,
        organization_id: user.membership_organization_id || null,
        brand_id: user.membership_brand_id || brandId || null,
        membership_id: user.membership_id || null,
        status: 'active',
        email_verified: Boolean(user.email_verified_at)
      }
    };
  }



  // ==================== AUDIT LOGGING ====================

  logSecurityEvent({ actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata }) {
    const id = 'sal_' + crypto.randomBytes(16).toString('hex');
    const safeMetadata = metadata ? JSON.stringify(metadata) : null;

    this.repository.prepare(`
      INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, actor_id || null, actor_role || null, action, target_user_id || null, target_role || null,
      brand_id || null, organization_id || null, branch_id || null, result, safeMetadata);
  }

  getSecurityAuditLog(brandId, { action, actor_id, target_user_id, limit = 50, offset = 0 } = {}) {
    let query = 'SELECT * FROM security_audit_log WHERE brand_id = ?';
    const params = [brandId];

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (actor_id) {
      query += ' AND actor_id = ?';
      params.push(actor_id);
    }
    if (target_user_id) {
      query += ' AND target_user_id = ?';
      params.push(target_user_id);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.repository.prepare(query).all(...params);
  }
}

module.exports = WorkforceService;
