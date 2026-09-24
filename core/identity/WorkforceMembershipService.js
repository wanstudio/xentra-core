'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');

/**
 * WorkforceMembershipService
 *
 * A Xentra User is an authentication identity. A workforce membership is the
 * user's role/scope relationship to one specific brand.
 *
 * This layer lets the same Xentra user be:
 *   Brand A -> owner
 *   Brand B -> brand_manager
 *
 * while keeping customer identity separately isolated in the Customer domain.
 */
class WorkforceMembershipService {
  constructor(database = db) {
    this.db = database;
  }

  findByUserAndBrand(userId, brandId) {
    if (!userId || !brandId) return null;

    return this.db.prepare(`
      SELECT id, user_id, organization_id, brand_id, branch_id, role, status,
             created_at, updated_at
      FROM workforce_memberships
      WHERE user_id = ? AND brand_id = ?
      LIMIT 1
    `).get(String(userId), String(brandId)) || null;
  }

  listForUser(userId, { activeOnly = false } = {}) {
    if (!userId) return [];

    const where = activeOnly ? ' AND status = \'active\'' : '';
    return this.db.prepare(`
      SELECT wm.id, wm.user_id, wm.organization_id, wm.brand_id, wm.branch_id,
             wm.role, wm.status, wm.created_at, wm.updated_at,
             b.name AS brand_name
      FROM workforce_memberships wm
      LEFT JOIN brands b ON b.id = wm.brand_id
      WHERE wm.user_id = ?${where}
      ORDER BY wm.created_at ASC
    `).all(String(userId));
  }

  ensureMembership({ userId, organizationId, brandId, branchId = null, role, status = 'active' }) {
    if (!userId || !organizationId || !brandId || !role) {
      throw { status: 400, code: 'INVALID_MEMBERSHIP', message: 'userId, organizationId, brandId, and role are required.' };
    }

    const now = new Date().toISOString();
    const id = 'wfm_' + crypto.randomBytes(12).toString('hex');

    this.db.prepare(`
      INSERT INTO workforce_memberships (
        id, user_id, organization_id, brand_id, branch_id, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, brand_id) DO UPDATE SET
        organization_id = excluded.organization_id,
        branch_id = excluded.branch_id,
        role = excluded.role,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      id,
      String(userId),
      String(organizationId),
      String(brandId),
      branchId ? String(branchId) : null,
      String(role),
      String(status),
      now,
      now
    );

    return this.findByUserAndBrand(userId, brandId);
  }

  updateRoleScope(userId, brandId, { role, branchId = null, status } = {}) {
    const current = this.findByUserAndBrand(userId, brandId);
    if (!current) {
      throw { status: 404, code: 'WORKFORCE_MEMBERSHIP_NOT_FOUND', message: 'Workforce membership not found.' };
    }

    const nextRole = role || current.role;
    const nextStatus = status || current.status;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE workforce_memberships
      SET role = ?, branch_id = ?, status = ?, updated_at = ?
      WHERE user_id = ? AND brand_id = ?
    `).run(
      nextRole,
      branchId !== undefined ? (branchId ? String(branchId) : null) : current.branch_id,
      nextStatus,
      now,
      String(userId),
      String(brandId)
    );

    return this.findByUserAndBrand(userId, brandId);
  }

  setStatus(userId, brandId, status) {
    if (!['active', 'disabled', 'suspended'].includes(String(status))) {
      throw { status: 400, code: 'INVALID_MEMBERSHIP_STATUS', message: 'Invalid workforce membership status.' };
    }

    const result = this.db.prepare(`
      UPDATE workforce_memberships
      SET status = ?, updated_at = ?
      WHERE user_id = ? AND brand_id = ?
    `).run(String(status), new Date().toISOString(), String(userId), String(brandId));

    if (!result.changes) {
      throw { status: 404, code: 'WORKFORCE_MEMBERSHIP_NOT_FOUND', message: 'Workforce membership not found.' };
    }

    return this.findByUserAndBrand(userId, brandId);
  }

  removeMembership(userId, brandId) {
    const result = this.db.prepare(
      'DELETE FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).run(String(userId), String(brandId));

    return { removed: result.changes > 0 };
  }

  countActiveOwners(brandId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM users u
      LEFT JOIN workforce_memberships wm
        ON wm.user_id = u.id AND wm.brand_id = ?
      WHERE COALESCE(wm.brand_id, u.brand_id) = ?
        AND COALESCE(wm.role, u.role) = 'owner'
        AND COALESCE(wm.status, u.status, 'active') = 'active'
    `).get(String(brandId), String(brandId));

    return Number(row && row.cnt ? row.cnt : 0);
  }
}

module.exports = WorkforceMembershipService;
