'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');
const { defaultEmailProvider } = require('./EmailProvider');

const INVITATION_TTL_DAYS = 7;
const ALLOWED_INVITATION_ROLES = ['brand_manager', 'branch_manager', 'cashier', 'kitchen'];

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email.trim());
}

/**
 * WorkforceInvitationService (Phase 3)
 *
 * Owns the workforce invitation lifecycle:
 * - PENDING -> ACCEPTED (Phase 4)
 * - PENDING -> REVOKED
 * - PENDING -> EXPIRED
 *
 * Principles:
 * - Invitation != User (no user account created on invite)
 * - Invitation != Email Verification (separate tokens & tables)
 * - Hash-only token storage (single-use, 7-day TTL)
 * - Resend supersedes prior active token
 * - Strict server-side RBAC & Organization/Brand/Branch hierarchy enforcement
 * - Append-only security audit logging
 * - Asynchronous email dispatch decoupled from invitation persistence
 */
class WorkforceInvitationService {
  constructor(database = db, emailProvider = defaultEmailProvider) {
    this.db = database;
    this.emailProvider = emailProvider;
  }

  hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
  }

  /**
   * Authorizes an actor's ability to create an invitation for a target role and scope.
   *
   * @param {Object} actor - { actor_id, actor_role, actor_branch_id }
   * @param {Object} target - { organization_id, brand_id, branch_id, role }
   * @returns {{ organization_id: string, brand_id: string, branch_id: string|null }}
   */
  authorizeInvitationCreation(actor, { organization_id, brand_id, branch_id, role }) {
    if (!actor || !actor.actor_role) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Actor is missing or unauthenticated.' };
    }

    if (!role || !ALLOWED_INVITATION_ROLES.includes(role)) {
      throw {
        status: 400,
        code: 'INVALID_ROLE',
        message: `Role must be one of: ${ALLOWED_INVITATION_ROLES.join(', ')}`
      };
    }

    // Role ceiling: determine what roles this actor can invite
    let allowedRoles = [];
    if (actor.actor_role === 'owner') {
      allowedRoles = ['brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'brand_manager') {
      allowedRoles = ['branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'branch_manager') {
      allowedRoles = ['cashier', 'kitchen'];
    } else {
      throw { status: 403, code: 'FORBIDDEN_ROLE_CEILING', message: 'Actor cannot invite team members.' };
    }

    if (!allowedRoles.includes(role)) {
      throw {
        status: 403,
        code: 'FORBIDDEN_ROLE_CEILING',
        message: `Role "${actor.actor_role}" cannot invite role "${role}".`
      };
    }

    // Scope ceiling & hierarchy validation
    if (!brand_id) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'brand_id is required.' };
    }

    const actorBrandId = actor.actor_brand_id || actor.brand_id;
    if (actorBrandId && actorBrandId !== brand_id) {
      throw { status: 403, code: 'FORBIDDEN_BRAND_SCOPE', message: 'Actor cannot invite team members for another brand.' };
    }

    const brand = this.db.prepare('SELECT id, organization_id, name FROM brands WHERE id = ?').get(brand_id);
    if (!brand) {
      throw { status: 404, code: 'BRAND_NOT_FOUND', message: 'Brand not found.' };
    }

    const authoritativeOrgId = brand.organization_id;
    const actorOrgId = actor.actor_org_id || actor.organization_id;
    if (actorOrgId && actorOrgId !== authoritativeOrgId) {
      throw { status: 403, code: 'FORBIDDEN_ORG_SCOPE', message: 'Actor cannot invite team members for another organization.' };
    }

    if (organization_id && organization_id !== authoritativeOrgId) {
      throw {
        status: 400,
        code: 'INVALID_HIERARCHY',
        message: 'Brand does not belong to specified organization.'
      };
    }

    let targetBranchId = branch_id ? String(branch_id).trim() : null;

    // Scope requirement per role:
    // - branch_manager: MUST have a specific branch_id
    // - cashier / kitchen: MUST have a specific branch_id
    // - brand_manager: branch_id is null (brand-wide)
    if (role === 'branch_manager' || role === 'cashier' || role === 'kitchen') {
      if (!targetBranchId && actor.actor_role === 'branch_manager') {
        targetBranchId = actor.actor_branch_id;
      }
      if (!targetBranchId) {
        throw {
          status: 400,
          code: 'BRANCH_REQUIRED',
          message: `Role "${role}" requires a specific branch scope.`
        };
      }
    } else if (role === 'brand_manager') {
      targetBranchId = null; // brand-wide authority, branch must be null
    }

    // Verify branch belongs to brand
    if (targetBranchId) {
      const branch = this.db.prepare('SELECT id, brand_id, name FROM branches WHERE id = ?').get(targetBranchId);
      if (!branch || branch.brand_id !== brand_id) {
        throw {
          status: 400,
          code: 'INVALID_BRANCH_HIERARCHY',
          message: 'Branch does not belong to the target brand.'
        };
      }

      // Branch Manager actor can only invite into their own branch
      if (actor.actor_role === 'branch_manager' && targetBranchId !== actor.actor_branch_id) {
        throw {
          status: 403,
          code: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Managers can only invite members within their authorized branch.'
        };
      }
    }

    return {
      organization_id: authoritativeOrgId,
      brand_id,
      branch_id: targetBranchId,
      brand_name: brand.name
    };
  }

  /**
   * Authorizes an actor to mutate an existing invitation (resend or revoke).
   * Enforces exact authoritative role ceiling, brand scope, and branch hierarchy.
   *
   * @param {Object} actor - { actor_id, actor_role, actor_branch_id, actor_brand_id, actor_org_id }
   * @param {Object} invitation - workforce_invitations row
   * @param {'resend'|'revoke'} actionType
   */
  _authorizeInvitationMutation(actor, invitation, actionType) {
    if (!actor || !actor.actor_role) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Actor is missing or unauthenticated.' };
    }

    const { actor_role } = actor;

    // Only Owner, Brand Manager, and Branch Manager can manage invitations
    if (actor_role !== 'owner' && actor_role !== 'brand_manager' && actor_role !== 'branch_manager') {
      throw {
        status: 403,
        code: 'FORBIDDEN_ROLE_CEILING',
        message: `Role "${actor_role}" is not authorized to ${actionType} invitations.`
      };
    }

    // Brand Scope enforcement
    const actorBrandId = actor.actor_brand_id || actor.brand_id;
    if (actorBrandId && actorBrandId !== invitation.brand_id) {
      throw {
        status: 403,
        code: 'FORBIDDEN_BRAND_SCOPE',
        message: `Actor cannot ${actionType} invitations for another brand.`
      };
    }

    // Org Scope enforcement
    const actorOrgId = actor.actor_org_id || actor.organization_id;
    if (actorOrgId && actorOrgId !== invitation.organization_id) {
      throw {
        status: 403,
        code: 'FORBIDDEN_ORG_SCOPE',
        message: `Actor cannot ${actionType} invitations for another organization.`
      };
    }

    // Role Ceiling enforcement
    if (actor_role === 'brand_manager') {
      // Brand Manager cannot resend or revoke owner or brand_manager invitations
      if (invitation.role === 'owner' || invitation.role === 'brand_manager') {
        throw {
          status: 403,
          code: 'FORBIDDEN_ROLE_CEILING',
          message: `Brand Manager cannot ${actionType} invitations for role "${invitation.role}".`
        };
      }
    } else if (actor_role === 'branch_manager') {
      // Branch Manager cannot resend or revoke managerial invitations (owner, brand_manager, branch_manager)
      if (invitation.role !== 'cashier' && invitation.role !== 'kitchen') {
        throw {
          status: 403,
          code: 'FORBIDDEN_ROLE_CEILING',
          message: `Branch Manager cannot ${actionType} managerial invitations.`
        };
      }

      // Branch Scope enforcement: Branch Manager can only manage invitations within their authorized branch
      const actorBranchId = actor.actor_branch_id || actor.branch_id;
      if (!actorBranchId || invitation.branch_id !== actorBranchId) {
        throw {
          status: 403,
          code: 'FORBIDDEN_BRANCH_SCOPE',
          message: `Branch Manager cannot ${actionType} invitations outside their branch.`
        };
      }
    }

    // Branch hierarchy validation: If invitation is scoped to a branch, verify branch belongs to brand
    if (invitation.branch_id) {
      const branch = this.db.prepare('SELECT id, brand_id FROM branches WHERE id = ?').get(invitation.branch_id);
      if (!branch || branch.brand_id !== invitation.brand_id) {
        throw {
          status: 400,
          code: 'INVALID_BRANCH_HIERARCHY',
          message: 'Branch does not belong to the target brand.'
        };
      }
    }
  }

  /**
   * Creates a new workforce invitation and dispatches TEAM_INVITATION email.
   *
   * @param {Object} params
   * @param {Object} params.actor - { actor_id, actor_role, actor_branch_id }
   * @param {string} params.email
   * @param {string} params.role
   * @param {string} params.brand_id
   * @param {string} [params.organization_id]
   * @param {string} [params.branch_id]
   * @returns {Promise<Object>}
   */
  async createInvitation({ actor, email, role, brand_id, organization_id, branch_id }) {
    if (!email || !isValidEmail(email)) {
      throw { status: 400, code: 'INVALID_EMAIL', message: 'Format email tidak valid.' };
    }
    const cleanEmail = email.trim().toLowerCase();

    // Authorize inviter & validate hierarchy
    let hierarchy;
    try {
      hierarchy = this.authorizeInvitationCreation(actor, {
        organization_id,
        brand_id,
        branch_id,
        role
      });
    } catch (authErr) {
      this._logSecurityEvent({
        actor_id: actor?.actor_id,
        actor_role: actor?.actor_role,
        action: 'INVITATION_CREATE_DENIED',
        brand_id,
        organization_id,
        branch_id,
        result: 'denied',
        metadata: { error: authErr.message, code: authErr.code, email: cleanEmail, role }
      });
      throw authErr;
    }

    const { organization_id: targetOrgId, brand_id: targetBrandId, branch_id: targetBranchId, brand_name: brandName } = hierarchy;

    // Get branch name if scoped
    let branchName = null;
    if (targetBranchId) {
      const b = this.db.prepare('SELECT name FROM branches WHERE id = ?').get(targetBranchId);
      if (b) branchName = b.name;
    }

    // Concurrency-safe pending invitation creation or supersession
    let existingPending = this.db.prepare(`
      SELECT * FROM workforce_invitations
      WHERE email = ? AND brand_id = ? AND status = 'pending'
    `).get(cleanEmail, targetBrandId);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    let invitationId;
    let isSuperseded = false;

    if (existingPending) {
      invitationId = existingPending.id;
      // Invalidate old token and update with new token hash and expiry atomically
      const updateRes = this.db.prepare(`
        UPDATE workforce_invitations
        SET role = ?, branch_id = ?, token_hash = ?, expires_at = ?, invited_by_user_id = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(role, targetBranchId, tokenHash, expiresAt, actor.actor_id, now, invitationId);

      if (updateRes.changes > 0) {
        isSuperseded = true;
        this._logSecurityEvent({
          actor_id: actor.actor_id,
          actor_role: actor.actor_role,
          action: 'INVITATION_SUPERSEDED',
          brand_id: targetBrandId,
          organization_id: targetOrgId,
          branch_id: targetBranchId,
          result: 'success',
          metadata: { invitation_id: invitationId, email: cleanEmail, role }
        });
      } else {
        // Concurrently changed status (e.g. accepted or revoked). Treat as new insert.
        existingPending = null;
      }
    }

    if (!existingPending || !isSuperseded) {
      invitationId = 'wiv_' + crypto.randomBytes(16).toString('hex');
      try {
        this.db.prepare(`
          INSERT INTO workforce_invitations (
            id, organization_id, brand_id, branch_id, email, role,
            invited_by_user_id, status, token_hash, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `).run(
          invitationId,
          targetOrgId,
          targetBrandId,
          targetBranchId,
          cleanEmail,
          role,
          actor.actor_id,
          tokenHash,
          expiresAt,
          now,
          now
        );

        this._logSecurityEvent({
          actor_id: actor.actor_id,
          actor_role: actor.actor_role,
          action: 'INVITATION_CREATED',
          brand_id: targetBrandId,
          organization_id: targetOrgId,
          branch_id: targetBranchId,
          result: 'success',
          metadata: { invitation_id: invitationId, email: cleanEmail, role }
        });
      } catch (err) {
        const isConstraint = err && (
          err.code === 'SQLITE_CONSTRAINT' || 
          err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (typeof err.message === 'string' && err.message.toLowerCase().includes('unique constraint'))
        );

        if (isConstraint) {
          // A concurrent request inserted a pending invitation right before us.
          // Atomically update and supersede that row with our token.
          const concurrentPending = this.db.prepare(`
            SELECT * FROM workforce_invitations
            WHERE email = ? AND brand_id = ? AND status = 'pending'
          `).get(cleanEmail, targetBrandId);

          if (concurrentPending) {
            invitationId = concurrentPending.id;
            this.db.prepare(`
              UPDATE workforce_invitations
              SET role = ?, branch_id = ?, token_hash = ?, expires_at = ?, invited_by_user_id = ?, updated_at = ?
              WHERE id = ? AND status = 'pending'
            `).run(role, targetBranchId, tokenHash, expiresAt, actor.actor_id, now, invitationId);

            this._logSecurityEvent({
              actor_id: actor.actor_id,
              actor_role: actor.actor_role,
              action: 'INVITATION_SUPERSEDED',
              brand_id: targetBrandId,
              organization_id: targetOrgId,
              branch_id: targetBranchId,
              result: 'success',
              metadata: { invitation_id: invitationId, email: cleanEmail, role }
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }

    // Dispatched post-persistence so external transport failure does NOT rollback invitation record
    const invitationUrl = `https://xentra.cloud/invite/${rawToken}`;
    let deliverySuccess = false;
    let deliveryError = null;

    try {
      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_ATTEMPTED',
        brand_id: targetBrandId,
        organization_id: targetOrgId,
        branch_id: targetBranchId,
        result: 'attempted',
        metadata: { invitation_id: invitationId, email: cleanEmail }
      });

      await this.emailProvider.sendTeamInvitation({
        to: cleanEmail,
        rawToken,
        role,
        brandName,
        branchName,
        expiresAt,
        invitationUrl
      });

      deliverySuccess = true;

      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_SUCCEEDED',
        brand_id: targetBrandId,
        organization_id: targetOrgId,
        branch_id: targetBranchId,
        result: 'success',
        metadata: { invitation_id: invitationId, email: cleanEmail }
      });
    } catch (err) {
      deliveryError = err && err.message ? err.message : String(err);
      console.error('[WorkforceInvitationService] Failed to dispatch invitation email:', deliveryError);

      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_FAILED',
        brand_id: targetBrandId,
        organization_id: targetOrgId,
        branch_id: targetBranchId,
        result: 'failed',
        metadata: { invitation_id: invitationId, email: cleanEmail, error: deliveryError }
      });
    }

    const result = {
      id: invitationId,
      email: cleanEmail,
      role,
      organization_id: targetOrgId,
      brand_id: targetBrandId,
      branch_id: targetBranchId,
      status: 'pending',
      expires_at: expiresAt,
      delivery: {
        success: deliverySuccess,
        error: deliveryError
      }
    };

    // ONLY in test environment, expose rawToken on returned result for test assertion purposes
    if (process.env.NODE_ENV === 'test') {
      result.rawToken = rawToken;
    }

    return result;
  }

  /**
   * Resends a pending invitation, superseding the previous token with a new one.
   *
   * @param {Object} params
   * @param {Object} params.actor - { actor_id, actor_role, actor_branch_id }
   * @param {string} params.invitation_id
   * @returns {Promise<Object>}
   */
  async resendInvitation({ actor, invitation_id }) {
    if (!actor || !actor.actor_role) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Actor is missing or unauthenticated.' };
    }

    if (!invitation_id || typeof invitation_id !== 'string') {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'invitation_id is required.' };
    }

    const invitation = this.db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(invitation_id);
    if (!invitation) {
      throw { status: 404, code: 'INVITATION_NOT_FOUND', message: 'Undangan tidak ditemukan.' };
    }

    // Authorize resend using authoritative role/scope/brand hierarchy rules
    try {
      this._authorizeInvitationMutation(actor, invitation, 'resend');
    } catch (authErr) {
      this._logSecurityEvent({
        actor_id: actor?.actor_id,
        actor_role: actor?.actor_role,
        action: 'INVITATION_RESEND_DENIED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'denied',
        metadata: { error: authErr.message, code: authErr.code, invitation_id: invitation.id, email: invitation.email }
      });
      throw authErr;
    }

    // Evaluate expiration
    if (invitation.status === 'pending' && new Date(invitation.expires_at) < new Date()) {
      this.db.prepare("UPDATE workforce_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(invitation.id);
      invitation.status = 'expired';
    }

    if (invitation.status !== 'pending') {
      throw {
        status: 400,
        code: 'INVALID_STATE',
        message: `Hanya undangan berstatus pending yang dapat dikirim ulang (status saat ini: ${invitation.status}).`
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Concurrency-safe atomic state transition: update token ONLY if still pending
    const updateResult = this.db.prepare(`
      UPDATE workforce_invitations
      SET token_hash = ?, expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(tokenHash, expiresAt, now, invitation.id);

    if (updateResult.changes === 0) {
      const latest = this.db.prepare('SELECT status, expires_at FROM workforce_invitations WHERE id = ?').get(invitation.id);
      if (!latest) {
        throw { status: 404, code: 'INVITATION_NOT_FOUND', message: 'Undangan tidak ditemukan.' };
      }
      throw {
        status: 400,
        code: 'INVALID_STATE',
        message: `Hanya undangan berstatus pending yang dapat dikirim ulang (status saat ini: ${latest.status}).`
      };
    }

    this._logSecurityEvent({
      actor_id: actor.actor_id,
      actor_role: actor.actor_role,
      action: 'INVITATION_RESENT',
      brand_id: invitation.brand_id,
      organization_id: invitation.organization_id,
      branch_id: invitation.branch_id,
      result: 'success',
      metadata: { invitation_id: invitation.id, email: invitation.email }
    });

    // Lookup brand and branch names
    const brand = this.db.prepare('SELECT name FROM brands WHERE id = ?').get(invitation.brand_id);
    let branchName = null;
    if (invitation.branch_id) {
      const branch = this.db.prepare('SELECT name FROM branches WHERE id = ?').get(invitation.branch_id);
      if (branch) branchName = branch.name;
    }

    const invitationUrl = `https://xentra.cloud/invite/${rawToken}`;
    let deliverySuccess = false;
    let deliveryError = null;

    try {
      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_ATTEMPTED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'attempted',
        metadata: { invitation_id: invitation.id, email: invitation.email }
      });

      await this.emailProvider.sendTeamInvitation({
        to: invitation.email,
        rawToken,
        role: invitation.role,
        brandName: brand?.name,
        branchName,
        expiresAt,
        invitationUrl
      });

      deliverySuccess = true;

      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_SUCCEEDED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'success',
        metadata: { invitation_id: invitation.id, email: invitation.email }
      });
    } catch (err) {
      deliveryError = err && err.message ? err.message : String(err);
      console.error('[WorkforceInvitationService] Failed to dispatch resend email:', deliveryError);

      this._logSecurityEvent({
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        action: 'INVITATION_SEND_FAILED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'failed',
        metadata: { invitation_id: invitation.id, email: invitation.email, error: deliveryError }
      });
    }

    const result = {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      organization_id: invitation.organization_id,
      brand_id: invitation.brand_id,
      branch_id: invitation.branch_id,
      status: 'pending',
      expires_at: expiresAt,
      delivery: {
        success: deliverySuccess,
        error: deliveryError
      }
    };

    if (process.env.NODE_ENV === 'test') {
      result.rawToken = rawToken;
    }

    return result;
  }

  /**
   * Revokes an invitation explicitly.
   *
   * @param {Object} params
   * @param {Object} params.actor - { actor_id, actor_role, actor_branch_id }
   * @param {string} params.invitation_id
   * @returns {Object}
   */
  revokeInvitation({ actor, invitation_id }) {
    if (!actor || !actor.actor_role) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Actor is missing or unauthenticated.' };
    }

    if (!invitation_id || typeof invitation_id !== 'string') {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'invitation_id is required.' };
    }

    const invitation = this.db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(invitation_id);
    if (!invitation) {
      throw { status: 404, code: 'INVITATION_NOT_FOUND', message: 'Undangan tidak ditemukan.' };
    }

    // Authorize revocation with full role/scope/brand hierarchy rules
    try {
      this._authorizeInvitationMutation(actor, invitation, 'revoke');
    } catch (authErr) {
      this._logSecurityEvent({
        actor_id: actor?.actor_id,
        actor_role: actor?.actor_role,
        action: 'INVITATION_REVOKE_DENIED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'denied',
        metadata: { error: authErr.message, code: authErr.code, invitation_id: invitation.id, email: invitation.email }
      });
      throw authErr;
    }

    if (invitation.status === 'revoked') {
      throw { status: 400, code: 'ALREADY_REVOKED', message: 'Undangan sudah dibatalkan sebelumnya.' };
    }
    if (invitation.status === 'accepted') {
      throw { status: 400, code: 'ALREADY_ACCEPTED', message: 'Undangan yang sudah diterima tidak dapat dibatalkan.' };
    }
    if (invitation.status === 'expired' || (invitation.status === 'pending' && new Date(invitation.expires_at) < new Date())) {
      this.db.prepare("UPDATE workforce_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(invitation.id);
      throw { status: 400, code: 'INVITATION_EXPIRED', message: 'Undangan telah kedaluwarsa dan tidak dapat dibatalkan.' };
    }

    const now = new Date().toISOString();
    // Invalidate token hash and set status to revoked atomically (pending -> revoked)
    const updateResult = this.db.prepare(`
      UPDATE workforce_invitations
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, now, invitation.id);

    if (updateResult.changes === 0) {
      const latest = this.db.prepare('SELECT status, expires_at FROM workforce_invitations WHERE id = ?').get(invitation.id);
      if (!latest) {
        throw { status: 404, code: 'INVITATION_NOT_FOUND', message: 'Undangan tidak ditemukan.' };
      }
      if (latest.status === 'revoked') {
        throw { status: 400, code: 'ALREADY_REVOKED', message: 'Undangan sudah dibatalkan sebelumnya.' };
      }
      if (latest.status === 'accepted') {
        throw { status: 400, code: 'ALREADY_ACCEPTED', message: 'Undangan yang sudah diterima tidak dapat dibatalkan.' };
      }
      if (latest.status === 'expired' || new Date(latest.expires_at) < new Date()) {
        throw { status: 400, code: 'INVITATION_EXPIRED', message: 'Undangan telah kedaluwarsa dan tidak dapat dibatalkan.' };
      }
      throw { status: 400, code: 'INVALID_STATE', message: `Tidak dapat membatalkan undangan dengan status ${latest.status}.` };
    }

    this._logSecurityEvent({
      actor_id: actor.actor_id,
      actor_role: actor.actor_role,
      action: 'INVITATION_REVOKED',
      brand_id: invitation.brand_id,
      organization_id: invitation.organization_id,
      branch_id: invitation.branch_id,
      result: 'success',
      metadata: { invitation_id: invitation.id, email: invitation.email }
    });

    return {
      success: true,
      id: invitation.id,
      status: 'revoked',
      revoked_at: now
    };
  }

  /**
   * Validates an invitation by raw token.
   * Evaluates hash match, status, and expiration.
   * Does NOT consume the token (Phase 4 responsibility).
   *
   * @param {string} rawToken
   * @returns {Object}
   */
  validateInvitationToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw { status: 400, code: 'INVALID_TOKEN', message: 'Token undangan tidak valid.' };
    }

    const tokenHash = this.hashToken(rawToken);
    const invitation = this.db.prepare(`
      SELECT wi.*, b.name as brand_name, br.name as branch_name
      FROM workforce_invitations wi
      JOIN brands b ON b.id = wi.brand_id
      LEFT JOIN branches br ON br.id = wi.branch_id
      WHERE wi.token_hash = ?
    `).get(tokenHash);

    if (!invitation) {
      throw { status: 404, code: 'INVITATION_NOT_FOUND', message: 'Undangan tidak ditemukan atau token salah.' };
    }

    // Check revoked
    if (invitation.status === 'revoked') {
      throw { status: 410, code: 'INVITATION_REVOKED', message: 'Undangan ini telah dibatalkan.' };
    }

    // Check accepted
    if (invitation.status === 'accepted') {
      throw { status: 410, code: 'INVITATION_ALREADY_ACCEPTED', message: 'Undangan ini telah digunakan.' };
    }

    // Check expired
    if (invitation.status === 'expired' || new Date(invitation.expires_at) < new Date()) {
      if (invitation.status !== 'expired') {
        this.db.prepare("UPDATE workforce_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(invitation.id);
        this._logSecurityEvent({
          actor_id: null,
          actor_role: 'system',
          action: 'INVITATION_EXPIRED',
          brand_id: invitation.brand_id,
          organization_id: invitation.organization_id,
          branch_id: invitation.branch_id,
          result: 'expired',
          metadata: { invitation_id: invitation.id }
        });
      }
      throw { status: 410, code: 'INVITATION_EXPIRED', message: 'Undangan ini telah kadaluarsa.' };
    }

    return {
      valid: true,
      invitation: {
        id: invitation.id,
        organization_id: invitation.organization_id,
        brand_id: invitation.brand_id,
        brand_name: invitation.brand_name,
        branch_id: invitation.branch_id,
        branch_name: invitation.branch_name,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expires_at: invitation.expires_at
      }
    };
  }

  /**
   * Lists invitations for a brand with optional filtering.
   *
   * @param {string} brandId
   * @param {Object} [filters]
   * @returns {Array<Object>}
   */
  listInvitations(brandId, { status, branch_id, role } = {}) {
    let query = `
      SELECT id, organization_id, brand_id, branch_id, email, role, invited_by_user_id, status,
             expires_at, accepted_at, revoked_at, created_at, updated_at
      FROM workforce_invitations
      WHERE brand_id = ?
    `;
    const params = [brandId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    query += ' ORDER BY created_at DESC';
    return this.db.prepare(query).all(...params);
  }

  /**
   * Accepts a workforce invitation.
   *
   * Lifecycle & Security:
   * - Validates token format and token hash match
   * - Evaluates invitation state (pending, not revoked, not expired)
   * - Enforces recipient identity verification (authenticated user email must match invitation email)
   * - Prevents privilege escalation: role and scope are strictly derived from invitation record
   * - Executes atomic pending -> accepted transition and user membership assignment
   * - Appends security audit log without logging secrets or raw tokens
   *
   * @param {Object} params
   * @param {Object} params.authenticatedUser - { id, email, ... } from verified session
   * @param {string} params.rawToken - The raw invitation token presented by recipient
   * @returns {Object} Acceptance result with membership summary
   */
  acceptInvitation({ authenticatedUser, rawToken }) {
    if (!authenticatedUser || !authenticatedUser.id || !authenticatedUser.email) {
      throw {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Pengguna harus login untuk menerima undangan.'
      };
    }

    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw {
        status: 400,
        code: 'INVALID_TOKEN',
        message: 'Token undangan tidak valid.'
      };
    }

    const tokenHash = this.hashToken(rawToken);
    const invitation = this.db.prepare(`
      SELECT wi.*, b.name as brand_name, br.name as branch_name
      FROM workforce_invitations wi
      JOIN brands b ON b.id = wi.brand_id
      LEFT JOIN branches br ON br.id = wi.branch_id
      WHERE wi.token_hash = ?
    `).get(tokenHash);

    if (!invitation) {
      throw {
        status: 404,
        code: 'INVITATION_NOT_FOUND',
        message: 'Undangan tidak ditemukan atau token salah.'
      };
    }

    // Check revoked
    if (invitation.status === 'revoked') {
      throw {
        status: 410,
        code: 'INVITATION_REVOKED',
        message: 'Undangan ini telah dibatalkan.'
      };
    }

    // Check already accepted
    if (invitation.status === 'accepted') {
      throw {
        status: 410,
        code: 'INVITATION_ALREADY_ACCEPTED',
        message: 'Undangan ini telah digunakan.'
      };
    }

    // Check expired
    if (invitation.status === 'expired' || new Date(invitation.expires_at) < new Date()) {
      if (invitation.status !== 'expired') {
        this.db.prepare("UPDATE workforce_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(invitation.id);
        this._logSecurityEvent({
          actor_id: null,
          actor_role: 'system',
          action: 'INVITATION_EXPIRED',
          brand_id: invitation.brand_id,
          organization_id: invitation.organization_id,
          branch_id: invitation.branch_id,
          result: 'expired',
          metadata: { invitation_id: invitation.id }
        });
      }
      throw {
        status: 410,
        code: 'INVITATION_EXPIRED',
        message: 'Undangan ini telah kadaluarsa.'
      };
    }

    if (invitation.status !== 'pending') {
      throw {
        status: 400,
        code: 'INVALID_STATE',
        message: `Tidak dapat menerima undangan dengan status ${invitation.status}.`
      };
    }

    // Identity check: authenticated user email must strictly match invitation email
    const userEmail = String(authenticatedUser.email).trim().toLowerCase();
    const inviteEmail = String(invitation.email).trim().toLowerCase();

    if (userEmail !== inviteEmail) {
      this._logSecurityEvent({
        actor_id: authenticatedUser.id,
        actor_role: authenticatedUser.role || null,
        action: 'INVITATION_ACCEPT_DENIED',
        brand_id: invitation.brand_id,
        organization_id: invitation.organization_id,
        branch_id: invitation.branch_id,
        result: 'denied',
        metadata: {
          invitation_id: invitation.id,
          reason: 'RECIPIENT_MISMATCH',
          role: invitation.role
        }
      });

      throw {
        status: 403,
        code: 'RECIPIENT_MISMATCH',
        message: 'Alamat email akun Anda tidak sesuai dengan alamat email penerima undangan.'
      };
    }

    // Check target user in database
    const userRecord = this.db.prepare('SELECT id, role, brand_id, organization_id, branch_id, status FROM users WHERE id = ?').get(authenticatedUser.id);
    if (!userRecord) {
      throw {
        status: 404,
        code: 'USER_NOT_FOUND',
        message: 'Akun pengguna tidak ditemukan.'
      };
    }

    // Atomic state transition: pending -> accepted and bind user to brand/role/scope
    const now = new Date().toISOString();

    // Use transaction to ensure both invitation status update and user scope/role assignment occur atomically
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const updateResult = this.db.prepare(`
        UPDATE workforce_invitations
        SET status = 'accepted', accepted_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, now, invitation.id);

      if (updateResult.changes === 0) {
        const latest = this.db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(invitation.id);
        if (latest && latest.status === 'accepted') {
          throw {
            status: 410,
            code: 'INVITATION_ALREADY_ACCEPTED',
            message: 'Undangan ini telah digunakan.'
          };
        }
        if (latest && latest.status === 'revoked') {
          throw {
            status: 410,
            code: 'INVITATION_REVOKED',
            message: 'Undangan ini telah dibatalkan.'
          };
        }
        throw {
          status: 400,
          code: 'INVALID_STATE',
          message: 'Undangan tidak lagi dalam status pending.'
        };
      }

      // Assign role and scope to user strictly from invitation record
      this.db.prepare(`
        UPDATE users
        SET role = ?,
            brand_id = ?,
            organization_id = ?,
            branch_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        invitation.role,
        invitation.brand_id,
        invitation.organization_id,
        invitation.branch_id || null,
        now,
        userRecord.id
      );

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    }

    // Invalidate existing sessions so permissions refresh immediately
    if (global.TokenSessionStore && global.TokenSessionStore.revokeUserSessions) {
      global.TokenSessionStore.revokeUserSessions(userRecord.id);
    }

    this._logSecurityEvent({
      actor_id: userRecord.id,
      actor_role: invitation.role,
      action: 'INVITATION_ACCEPTED',
      brand_id: invitation.brand_id,
      organization_id: invitation.organization_id,
      branch_id: invitation.branch_id,
      result: 'success',
      metadata: {
        invitation_id: invitation.id,
        role: invitation.role,
        brand_id: invitation.brand_id,
        branch_id: invitation.branch_id
      }
    });

    return {
      success: true,
      invitation_id: invitation.id,
      user_id: userRecord.id,
      role: invitation.role,
      organization_id: invitation.organization_id,
      brand_id: invitation.brand_id,
      brand_name: invitation.brand_name,
      branch_id: invitation.branch_id,
      branch_name: invitation.branch_name,
      status: 'accepted',
      accepted_at: now
    };
  }

  _logSecurityEvent({ actor_id, actor_role, action, brand_id, organization_id, branch_id, result, metadata }) {
    try {
      const id = 'sal_' + crypto.randomBytes(16).toString('hex');
      const safeMetadata = metadata ? JSON.stringify(metadata) : null;

      this.db.prepare(`
        INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        actor_id || null,
        actor_role || null,
        action,
        metadata?.role || null,
        brand_id || null,
        organization_id || null,
        branch_id || null,
        result,
        safeMetadata
      );
    } catch (e) {
      console.error('[WorkforceInvitationService] Failed to record security audit log:', e);
    }
  }
}

module.exports = WorkforceInvitationService;
