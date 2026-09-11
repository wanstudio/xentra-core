'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');
const ExistingTenantResolver = require('./ExistingTenantResolver');

class OwnershipClaimService {
  constructor(database = db, resolver = new ExistingTenantResolver(database)) {
    this.db = database;
    this.resolver = resolver;
    if (!global.__ownershipClaimChallenges) {
      global.__ownershipClaimChallenges = new Map();
    }
    this.challenges = global.__ownershipClaimChallenges;
  }

  /**
   * Evaluates if a domain represents an existing claimable tenant.
   *
   * @param {string} domainInput
   * @returns {Object} Public claim evaluation result
   */
  checkDomain(domainInput) {
    const cleanDomain = this.resolver.normalizeDomain(domainInput);
    if (!cleanDomain) {
      throw { status: 400, code: 'INVALID_DOMAIN', message: 'Domain bisnis tidak boleh kosong.' };
    }

    const tenant = this.resolver.resolveByDomain(cleanDomain);
    if (!tenant) {
      return {
        exists: false,
        domain: cleanDomain,
        message: 'Domain belum terdaftar. Anda dapat membuat bisnis baru.'
      };
    }

    // Check if brand already has users/owners
    const ownerCountRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM users WHERE brand_id = ? AND role = 'owner'"
    ).get(tenant.brand_id);

    return {
      exists: true,
      domain: tenant.custom_domain,
      business_name: tenant.business_name,
      organization_name: tenant.organization_name,
      logo_url: tenant.logo_url,
      branch_count: tenant.branch_count,
      has_active_owner: Boolean(ownerCountRow && ownerCountRow.cnt > 0)
    };
  }

  /**
   * Prepares a claim request / challenge for a verified user.
   *
   * @param {Object} params
   * @param {string} params.domain
   * @param {string} params.userId
   * @returns {Object} Claim challenge details
   */
  initiateClaim({ domain, userId }) {
    if (!domain || !userId) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Domain and userId are required.' };
    }

    const tenant = this.resolver.resolveByDomain(domain);
    if (!tenant) {
      throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Bisnis dengan domain tersebut tidak ditemukan.' };
    }

    const user = this.db.prepare('SELECT id, email, status, role FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'Pengguna tidak ditemukan.' };
    }
    if (user.status !== 'active') {
      throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'Akun pengguna tidak aktif.' };
    }

    const challengeCode = 'clm_' + crypto.randomBytes(16).toString('hex');
    const challengeData = {
      challengeCode,
      domain: tenant.custom_domain,
      brandId: tenant.brand_id,
      organizationId: tenant.organization_id,
      userId: user.id,
      userEmail: user.email,
      businessName: tenant.business_name,
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
    };

    this.challenges.set(challengeCode, challengeData);

    return {
      success: true,
      challenge_code: challengeCode,
      domain: tenant.custom_domain,
      business_name: tenant.business_name,
      expires_at: new Date(challengeData.expiresAt).toISOString()
    };
  }

  /**
   * Verifies and fetches an active claim challenge.
   *
   * @param {string} challengeCode
   * @returns {Object} Challenge payload
   */
  getChallenge(challengeCode) {
    if (!challengeCode) return null;
    const challenge = this.challenges.get(challengeCode);
    if (!challenge) return null;
    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(challengeCode);
      return null;
    }
    return challenge;
  }

  /**
   * Invalidate used challenge.
   *
   * @param {string} challengeCode
   */
  consumeChallenge(challengeCode) {
    if (challengeCode) {
      this.challenges.delete(challengeCode);
    }
  }
}

module.exports = OwnershipClaimService;
