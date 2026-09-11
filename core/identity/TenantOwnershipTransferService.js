'use strict';

const db = require('../../server/database/db');
const ExistingTenantResolver = require('./ExistingTenantResolver');
const WorkforceService = require('./WorkforceService');

class TenantOwnershipTransferService {
  constructor(database = db, resolver = new ExistingTenantResolver(database)) {
    this.db = database;
    this.resolver = resolver;
    this.workforce = new WorkforceService();
  }

  /**
   * Safely attaches a Xentra User to an existing tenant as owner.
   *
   * Crucial invariants:
   * 1. Existing tenant (Organization, Brand, Branches, Catalog, Orders, Inventory, etc.) MUST NOT be duplicated.
   * 2. No brand_bangjo_new or similar suffix.
   * 3. Attach current user to target organization_id and brand_id, setting role = 'owner' and status = 'active'.
   * 4. Audit security event.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.domain
   * @param {string} [params.password] Optional legacy password verification if existing owner credentials exist
   * @returns {Object} Attached tenant and updated user
   */
  claimAndAttachTenant({ userId, domain, password = null }) {
    if (!userId) {
      throw { status: 400, code: 'INVALID_USER_ID', message: 'User ID is required.' };
    }
    if (!domain) {
      throw { status: 400, code: 'INVALID_DOMAIN', message: 'Domain is required.' };
    }

    const tenant = this.resolver.resolveByDomain(domain);
    if (!tenant) {
      throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Bisnis dengan domain tersebut tidak ditemukan.' };
    }

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'Pengguna tidak ditemukan.' };
    }
    if (user.status !== 'active') {
      throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'Akun pengguna tidak aktif.' };
    }

    // Check if the tenant has existing owners and if legacy password verification is provided
    const existingOwners = this.db.prepare(
      "SELECT id, username, password_hash, email FROM users WHERE brand_id = ? AND role = 'owner'"
    ).all(tenant.brand_id);

    // If password provided, verify against any existing owner password
    if (password && existingOwners.length > 0) {
      let passwordMatched = false;
      for (const owner of existingOwners) {
        if (this.workforce.verifyPassword(password, owner.password_hash)) {
          passwordMatched = true;
          break;
        }
      }
      if (!passwordMatched) {
        throw {
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Password verifikasi bisnis tidak sesuai.'
        };
      }
    }

    const now = new Date().toISOString();

    // Atomic tenant attachment
    this.db.exec('BEGIN;');
    try {
      // Update user to be bound to this existing organization and brand with role 'owner'
      this.db.prepare(`
        UPDATE users
        SET organization_id = ?,
            brand_id = ?,
            role = 'owner',
            status = 'active',
            updated_at = ?
        WHERE id = ?
      `).run(tenant.organization_id, tenant.brand_id, now, user.id);

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    }

    // Refresh user record
    const updatedUser = this.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

    // Audit log
    this.workforce.logSecurityEvent({
      actor_id: user.id,
      actor_role: 'owner',
      action: 'TENANT_ADOPTED_AND_ATTACHED',
      target_user_id: user.id,
      target_role: 'owner',
      brand_id: tenant.brand_id,
      organization_id: tenant.organization_id,
      result: 'success',
      metadata: {
        domain: tenant.custom_domain,
        business_name: tenant.business_name,
        user_email: user.email
      }
    });

    return {
      success: true,
      message: `Bisnis "${tenant.business_name}" berhasil diklaim dan dihubungkan ke akun Anda.`,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        full_name: updatedUser.full_name,
        role: updatedUser.role,
        brand_id: updatedUser.brand_id,
        organization_id: updatedUser.organization_id,
        branch_id: updatedUser.branch_id || null,
        email_verified: Boolean(updatedUser.email_verified_at)
      },
      business: {
        brand_id: tenant.brand_id,
        organization_id: tenant.organization_id,
        name: tenant.business_name,
        custom_domain: tenant.custom_domain,
        logo_url: tenant.logo_url,
        branch_count: tenant.branch_count
      }
    };
  }
}

module.exports = TenantOwnershipTransferService;
