/**
 * XENTRA CORE — WORKFORCE ROUTES
 *
 * Staff accounts, password lifecycle, security audit and workforce
 * invitation lifecycle. Authorization remains server-side and tenant-scoped.
 */
'use strict';

const { WorkforceService, WorkforceInvitationService } = require('../../core/identity');

module.exports = function registerWorkforceRoutes(router, deps) {
  const {
    db,
    requireAuth,
    TokenSessionStore
  } = deps;

// ==================== WORKFORCE MANAGEMENT ENDPOINTS ====================
const { WorkforceService, WorkforceInvitationService } = require('../../core/identity');

// Helper: extract workforce actor context from session
function getWorkforceActor(req) {
  return {
    actor_id: req.user.userId || req.user.id,
    actor_role: req.user.role,
    actor_branch_id: req.user.branchId || req.user.branch_id
  };
}

// List users within authorized scope
router.get('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { role, branch_id, status, limit, offset } = req.query;
    
    // Branch managers can only see users in their branch
    const filters = {};
    if (role) filters.role = role;
    if (status) filters.status = status;
    if (req.user.role === 'branch_manager') {
      filters.branch_id = req.user.branchId || req.user.branch_id;
    } else if (branch_id) {
      filters.branch_id = branch_id;
    }
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const users = workforce.listUsers(req.brand_id, filters);
    res.json({ success: true, users });
  } catch (err) {
    console.error('[Admin Users List Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single user
router.get('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const user = workforce.getUser(req.params.id, req.brand_id);
    
    // Branch managers can only see users in their branch
    if (req.user.role === 'branch_manager' && user.branch_id !== (req.user.branchId || req.user.branch_id)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
    }

    res.json({ success: true, user });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Create user
router.post('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { username, email, password, full_name, role, branch_id } = req.body;

    // Authorization: determine what role/scope the actor can assign
    let allowedRoles = [];
    let targetBranchId = branch_id;

    if (actor.actor_role === 'owner') {
      allowedRoles = ['brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'brand_manager') {
      allowedRoles = ['branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'branch_manager') {
      allowedRoles = ['cashier'];
      targetBranchId = actor.actor_branch_id; // Force to own branch
    }

    if (!allowedRoles.includes(role)) {
      workforce.logSecurityEvent({
        ...actor,
        action: 'USER_CREATED',
        brand_id: req.brand_id,
        result: 'denied',
        metadata: { reason: 'FORBIDDEN_ROLE_CEILING', requested_role: role }
      });
      return res.status(403).json({ 
        success: false, 
        error: 'FORBIDDEN_ROLE_CEILING',
        message: 'Anda tidak memiliki izin untuk membuat akun dengan role ini.' 
      });
    }

    // Validate branch scope
    if (targetBranchId) {
      const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH' });
      }
      
      // Branch manager cannot assign to different branch
      if (actor.actor_role === 'branch_manager' && targetBranchId !== actor.actor_branch_id) {
        workforce.logSecurityEvent({
          ...actor,
          action: 'USER_CREATED',
          brand_id: req.brand_id,
          result: 'denied',
          metadata: { reason: 'FORBIDDEN_SCOPE_ESCALATION', requested_branch: targetBranchId }
        });
        return res.status(403).json({ success: false, error: 'FORBIDDEN_SCOPE_ESCALATION' });
      }
    }

    // Get organization_id from brand
    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    
    const newUser = workforce.createUser({
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      username,
      email,
      password,
      full_name,
      role,
      created_by: actor.actor_id
    });

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_CREATED',
      target_user_id: newUser.id,
      target_role: role,
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      result: 'success',
      metadata: { username }
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Update user profile
router.put('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const target = workforce.getUser(req.params.id, req.brand_id);

    // Branch managers can only update Cashier in their branch
    if (actor.actor_role === 'branch_manager') {
      if (target.role !== 'cashier' || target.branch_id !== actor.actor_branch_id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const updated = workforce.updateUser(req.params.id, req.brand_id, req.body, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_UPDATED',
      target_user_id: target.id,
      target_role: target.role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { fields: Object.keys(req.body) }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Disable user
router.post('/admin/users/:id/disable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const disabled = workforce.disableUser(req.params.id, req.brand_id, actor);

    // Invalidate all sessions for the disabled user
    workforce.invalidateUserSessions(req.params.id);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_DISABLED',
      target_user_id: disabled.id,
      target_role: disabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: disabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Enable user
router.post('/admin/users/:id/enable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const enabled = workforce.enableUser(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_ENABLED',
      target_user_id: enabled.id,
      target_role: enabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: enabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Delete user (Owner only)
router.delete('/admin/users/:id', requireAuth(['owner']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const deleted = workforce.deleteUser(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_DELETED',
      target_user_id: deleted.deleted_user_id,
      target_role: deleted.role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { deleted_user_name: deleted.deleted_user_name }
    });

    res.json({ success: true, message: 'Anggota tim berhasil dihapus.', ...deleted });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message, code: err.code });
  }
});

// Change user role (Owner only)
router.post('/admin/users/:id/role', requireAuth(['owner']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { role } = req.body;

    const updated = workforce.changeUserRole(req.params.id, req.brand_id, role, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'ROLE_CHANGED',
      target_user_id: updated.id,
      target_role: role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { previous_role: updated.role }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Change user branch scope
router.post('/admin/users/:id/scope', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { branch_id } = req.body;

    const updated = workforce.changeUserScope(req.params.id, req.brand_id, branch_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'SCOPE_CHANGED',
      target_user_id: updated.id,
      target_role: updated.role,
      brand_id: req.brand_id,
      branch_id: branch_id,
      result: 'success',
      metadata: { previous_branch_id: updated.branch_id }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ==================== PASSWORD MANAGEMENT ====================

// Self password change
router.post('/auth/change-password', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ success: false, error: 'CURRENT_PASSWORD_REQUIRED' });
    }

    workforce.selfChangePassword(
      req.user.userId || req.user.id,
      req.brand_id,
      current_password,
      new_password,
      confirm_password
    );

    // Invalidate all sessions except current one (force re-login on other devices)
    const currentToken = req.headers['authorization']?.startsWith('Bearer ') 
      ? req.headers['authorization'].substring(7).trim()
      : req.headers['x-auth-token'];
    
    // Revoke all sessions for this user except the current one
    const userId = req.user.userId || req.user.id;
    if (TokenSessionStore.revokeUserSessionsExcept) {
      TokenSessionStore.revokeUserSessionsExcept(userId, currentToken);
    } else {
      for (const [token, session] of TokenSessionStore.sessions.entries()) {
        if ((session.userId === userId || session.id === userId) && token !== currentToken) {
          TokenSessionStore.sessions.delete(token);
        }
      }
    }

    workforce.logSecurityEvent({
      actor_id: userId,
      actor_role: req.user.role,
      action: 'PASSWORD_CHANGED',
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil diubah.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Admin reset password (generates one-time token)
router.post('/admin/users/:id/reset-password', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const result = workforce.adminResetPassword(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'PASSWORD_RESET_REQUESTED',
      target_user_id: req.params.id,
      brand_id: req.brand_id,
      result: 'success'
    });

    // NOTE: The raw reset token is returned ONCE to the administrator
    // who must securely transmit it to the target user.
    // It is NEVER logged or stored in plaintext.
    res.json({ 
      success: true, 
      reset_token: result.reset_token,
      expires_at: result.expires_at,
      message: 'Reset token berhasil dibagikan. Berikan token ini kepada pengguna secara aman.' 
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Complete password reset (using one-time token)
router.post('/auth/reset-password', (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ success: false, error: 'Token dan password baru wajib diisi.' });
    }

    const result = workforce.completePasswordReset(token, new_password);

    workforce.logSecurityEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      target_user_id: result.user_id,
      brand_id: result.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil direset. Silakan login dengan password baru.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Logout
router.post('/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (token) {
      const session = TokenSessionStore.getSession(token);
      if (session) {
        const workforce = new WorkforceService();
        workforce.logSecurityEvent({
          actor_id: session.userId || session.id,
          actor_role: session.role,
          action: 'LOGOUT',
          brand_id: req.brand_id,
          result: 'success'
        });
      }
      TokenSessionStore.destroySession(token);
    }

    res.json({ success: true, message: 'Berhasil logout.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Security audit log (Owner/Brand Manager only)
router.get('/admin/security-audit', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { action, actor_id, target_user_id, limit, offset } = req.query;

    const logs = workforce.getSecurityAuditLog(req.brand_id, {
      action,
      actor_id,
      target_user_id,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: sanitize invitation objects for the public REST API contract (prevents leaking internal provider errors or credentials)
function sanitizePublicInvitation(invitation) {
  if (!invitation || typeof invitation !== 'object') return invitation;
  const safe = { ...invitation };
  if (safe.delivery) {
    safe.delivery = {
      success: Boolean(safe.delivery.success),
      error: safe.delivery.success ? null : 'EMAIL_DELIVERY_FAILED'
    };
  }
  return safe;
}

// ==================== WORKFORCE INVITATIONS (PHASE 3) ====================
// Create workforce invitation
router.post('/admin/invitations', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);
    const { email, role, branch_id } = req.body;

    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    if (!brand) {
      return res.status(404).json({ success: false, error: 'BRAND_NOT_FOUND', message: 'Brand not found.' });
    }

    const invitation = await invitationService.createInvitation({
      actor,
      email,
      role,
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id
    });

    res.status(201).json({ success: true, invitation: sanitizePublicInvitation(invitation) });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'INVITATION_ERROR', message: err.message });
  }
});

// List workforce invitations for brand
router.get('/admin/invitations', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const { status, branch_id, role } = req.query;

    const effectiveBranchId = req.user.role === 'branch_manager'
      ? (req.user.branchId || req.user.branch_id)
      : branch_id;

    const invitations = invitationService.listInvitations(req.brand_id, {
      status,
      branch_id: effectiveBranchId,
      role
    });

    res.json({ success: true, invitations });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'LIST_ERROR', message: err.message });
  }
});

// Resend workforce invitation
router.post('/admin/invitations/:id/resend', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);

    const result = await invitationService.resendInvitation({
      actor,
      invitation_id: req.params.id
    });

    res.json({ success: true, invitation: sanitizePublicInvitation(result) });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'RESEND_ERROR', message: err.message });
  }
});

// Revoke workforce invitation
router.post('/admin/invitations/:id/revoke', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);

    const result = invitationService.revokeInvitation({
      actor,
      invitation_id: req.params.id
    });

    res.json({ success: true, invitation: result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'REVOKE_ERROR', message: err.message });
  }
});

// Validate workforce invitation token capability (Public capability check)
router.get('/invitations/validate/:token', (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const result = invitationService.validateInvitationToken(req.params.token);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'VALIDATION_ERROR', message: err.message });
  }
});

// Accept workforce invitation (Phase 4: Authenticated recipient acceptance)
// Client cannot supply or alter role/brand/branch; derived strictly from invitation record
const handleAcceptInvitation = async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const authenticatedUser = req.user;
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Token undangan wajib diisi.'
      });
    }

    const result = invitationService.acceptInvitation({
      authenticatedUser,
      rawToken: token
    });

    // Preserve the unified role-based landing contract after invitation acceptance.
    // Cashiers execute transactions in POS; management roles use the dashboard.
    let redirectUrl = result.role === 'cashier' ? '/pos/' : '/dashboard/';
    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();
    if (result.brand_id && cleanHost === 'xentra.cloud') {
      const brandRow = db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(result.brand_id);
      if (brandRow && brandRow.custom_domain) {
        const { HandoffService } = require('../../core/identity');
        const handoffService = new HandoffService(db);
        try {
          const ticketInfo = handoffService.createTicket({
            userId: authenticatedUser.id || authenticatedUser.userId,
            brandId: brandRow.id,
            ttlSeconds: 60
          });
          redirectUrl = ticketInfo.redirect_url;
        } catch (_) {}
      }
    }

    res.json({ success: true, redirect_url: redirectUrl, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: err.code || 'ACCEPT_ERROR',
      message: err.message
    });
  }
};

router.post('/invitations/accept', requireAuth(), handleAcceptInvitation);
router.post('/admin/invitations/accept', requireAuth(), handleAcceptInvitation);

// ==================== END WORKFORCE MANAGEMENT ====================

};
