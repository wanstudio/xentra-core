const WorkforceRepository = require('../data/repositories/WorkforceRepository');

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

class WorkforceService {
  constructor(repository = new WorkforceRepository()) {
    this.repository = repository instanceof WorkforceRepository ? repository : new WorkforceRepository(repository);
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
    // Validate required fields
    if (!brand_id || !organization_id || !username || !password || !role) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'brand_id, organization_id, username, password, and role are required.' };
    }

    // Validate role
    const allowedRoles = ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    if (!allowedRoles.includes(role)) {
      throw { status: 400, code: 'INVALID_ROLE', message: `Role must be one of: ${allowedRoles.join(', ')}` };
    }

    // Validate username format
    if (!/^[a-z0-9._-]+$/.test(username)) {
      throw { status: 400, code: 'INVALID_USERNAME', message: 'Username must contain only lowercase letters, numbers, dots, hyphens, and underscores.' };
    }

    // Check username uniqueness within brand
    const existing = this.repository.prepare('SELECT id FROM users WHERE username = ? AND brand_id = ?').get(username, brand_id);
    if (existing) {
      throw { status: 409, code: 'USERNAME_EXISTS', message: 'Username already exists in this brand.' };
    }

    // Validate branch exists if provided
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
      INSERT INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role, status, password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, brand_id, organization_id, branch_id || null, username, email || null, password_hash, full_name || null, role, now, now, now);

    return { id, username, email, full_name, role, branch_id: branch_id || null, status: 'active' };
  }

  getUser(userId, brandId) {
    const user = this.repository.prepare(`
      SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status, 
             created_at, updated_at, last_login_at, password_changed_at
      FROM users WHERE id = ? AND brand_id = ?
    `).get(userId, brandId);
    if (!user) throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    return user;
  }

  listUsers(brandId, { role, branch_id, status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status,
             created_at, updated_at, last_login_at
      FROM users WHERE brand_id = ?
    `;
    const params = [brandId];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.repository.prepare(query).all(...params);
  }

  updateUser(userId, brandId, updates, { actor_id, actor_role } = {}) {
    const user = this.getUser(userId, brandId);

    // Brand Manager can only update Cashier profiles
    if (actor_role === 'brand_manager') {
      if (user.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only update Cashier accounts.' };
      }
    }

    const allowedFields = ['full_name', 'email'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      throw { status: 400, code: 'NO_VALID_FIELDS', message: 'No valid fields to update.' };
    }

    setClauses.push('updated_at = datetime(\'now\')');
    params.push(userId, brandId);

    this.repository.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ? AND brand_id = ?`).run(...params);

    return this.getUser(userId, brandId);
  }

  disableUser(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    // Last-owner protection
    if (target.role === 'owner') {
      const ownerCount = this.repository.prepare('SELECT COUNT(*) as cnt FROM users WHERE brand_id = ? AND role = ? AND status = ?').get(brandId, 'owner', 'active');
      if (ownerCount.cnt <= 1) {
        throw { status: 400, code: 'LAST_OWNER_PROTECTED', message: 'Cannot disable the last Owner account.' };
      }
    }

    // Authorization: Manager can only disable Cashier within own branch
    if (actor_role === 'branch_manager' || actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only disable Cashier accounts.' };
      }
      if (actor_role === 'branch_manager' && target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only disable Cashier accounts within their branch.' };
      }
    }

    this.repository.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?')
      .run('disabled', targetUserId, brandId);

    return { ...target, status: 'disabled' };
  }

  enableUser(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    // Authorization: Manager can only enable Cashier within own branch
    if (actor_role === 'branch_manager' || actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only enable Cashier accounts.' };
      }
      if (actor_role === 'branch_manager' && target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only enable Cashier accounts within their branch.' };
      }
    }

    this.repository.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?')
      .run('active', targetUserId, brandId);

    // Clean up revocation marker so the user can log in again
    if (global.TokenSessionStore && global.TokenSessionStore.revokedUserIds) {
      global.TokenSessionStore.revokedUserIds.delete(targetUserId);
    }

    return { ...target, status: 'active' };
  }

  changeUserRole(targetUserId, brandId, newRole, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    // Only Owner can change roles
    if (actor_role !== 'owner') {
      throw { status: 403, code: 'FORBIDDEN_ROLE_CHANGE', message: 'Only Owner can change user roles.' };
    }

    // Validate new role
    const allowedRoles = ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    if (!allowedRoles.includes(newRole)) {
      throw { status: 400, code: 'INVALID_ROLE', message: `Role must be one of: ${allowedRoles.join(', ')}` };
    }

    // Prevent demoting the last owner
    if (target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = this.repository.prepare('SELECT COUNT(*) as cnt FROM users WHERE brand_id = ? AND role = ? AND status = ?').get(brandId, 'owner', 'active');
      if (ownerCount.cnt <= 1) {
        throw { status: 400, code: 'LAST_OWNER_PROTECTED', message: 'Cannot demote the last Owner account.' };
      }
    }

    this.repository.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?')
      .run(newRole, targetUserId, brandId);

    // Invalidate all sessions for the target user (role changed — stale sessions must not survive)
    this.invalidateUserSessions(targetUserId);

    return { ...target, role: newRole };
  }

  changeUserScope(targetUserId, brandId, newBranchId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.getUser(targetUserId, brandId);

    // Brand Manager can only change scope of Cashier (not other managers/owner)
    if (actor_role === 'brand_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only change scope of Cashier accounts.' };
      }
    }

    // Branch Manager can only change scope of Cashier within own branch
    if (actor_role === 'branch_manager') {
      if (target.role !== 'cashier') {
        throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Managers can only change scope of Cashier accounts.' };
      }
      if (target.branch_id !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_BRANCH_SCOPE', message: 'Managers can only change scope of Cashier accounts within their branch.' };
      }
      // Manager cannot assign to a different branch
      if (newBranchId && newBranchId !== actor_branch_id) {
        throw { status: 403, code: 'FORBIDDEN_SCOPE_ESCALATION', message: 'Managers cannot assign Cashier to a different branch.' };
      }
    }

    // Validate branch exists if provided
    if (newBranchId) {
      const branch = this.repository.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(newBranchId, brandId);
      if (!branch) {
        throw { status: 400, code: 'INVALID_BRANCH', message: 'Branch does not belong to this brand.' };
      }
    }

    this.repository.prepare('UPDATE users SET branch_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?')
      .run(newBranchId || null, targetUserId, brandId);

    // Invalidate all sessions for the target user (scope changed — stale sessions must not survive)
    this.invalidateUserSessions(targetUserId);

    return { ...target, branch_id: newBranchId || null };
  }

  // ==================== PASSWORD MANAGEMENT ====================

  selfChangePassword(userId, brandId, currentPassword, newPassword, confirmPassword) {
    if (newPassword !== confirmPassword) {
      throw { status: 400, code: 'PASSWORD_MISMATCH', message: 'New password and confirmation do not match.' };
    }

    if (newPassword.length < 8) {
      throw { status: 400, code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.' };
    }

    const user = this.repository.prepare('SELECT * FROM users WHERE id = ? AND brand_id = ?').get(userId, brandId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }

    // Verify current password
    if (!this.verifyPassword(currentPassword, user.password_hash)) {
      throw { status: 401, code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' };
    }

    // Hash new password
    const newHash = this.hashPassword(newPassword);

    // Update password
    this.repository.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?')
      .run(newHash, userId, brandId);

    return { success: true };
  }

  adminResetPassword(targetUserId, brandId, { actor_id, actor_role, actor_branch_id }) {
    const target = this.repository.prepare('SELECT * FROM users WHERE id = ? AND brand_id = ?').get(targetUserId, brandId);
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

    // Mark token as used
    this.repository.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(tokenRecord.id);

    // Update password
    const newHash = this.hashPassword(newPassword);
    this.repository.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
      .run(newHash, tokenRecord.user_id);

    return { success: true, user_id: tokenRecord.user_id, brand_id: tokenRecord.brand_id };
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
    const user = this.repository.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND brand_id = ?')
      .get(username, username, brandId);

    if (!user) {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Check if account is disabled
    if (user.status === 'disabled') {
      return { success: false, error: 'ACCOUNT_DISABLED', message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.' };
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return { success: false, error: 'ACCOUNT_LOCKED', message: 'Akun Anda terkunci sementara. Coba lagi nanti.' };
    }

    // Verify password
    if (!this.verifyPassword(password, user.password_hash)) {
      // Increment failed attempts
      const attempts = (user.failed_login_attempts || 0) + 1;
      const updates = { failed_login_attempts: attempts };

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        updates.locked_until = lockUntil;
      }

      this.repository.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(attempts, updates.locked_until || null, user.id);

      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Successful login - reset failed attempts and update last_login_at
    this.repository.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
      .run(user.id);

    // Re-hash with bcrypt if using legacy SHA-256
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
        role: user.role,
        branch_id: user.branch_id,
        organization_id: user.organization_id,
        status: 'active'
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
