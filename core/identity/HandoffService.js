'use strict';

const crypto = require('crypto');
const db = require('../../server/database/db');
const { BrandRepository } = require('../data/repositories');

class HandoffService {
  constructor(database = db) {
    this.db = database;
    this.brandRepository = new BrandRepository();
    if (!global.__handoffTickets) {
      global.__handoffTickets = new Map();
    }
    this.tickets = global.__handoffTickets;
  }

  /**
   * Strictly validates a return_to URL according to Phase 3 requirements.
   * Resolves target brand via authoritative BrandRepository / DomainRegistry.
   *
   * @param {string} returnTo
   * @returns {{ valid: boolean, url: URL, hostname: string, brand: Object }}
   */
  validateReturnTo(returnTo) {
    if (!returnTo || typeof returnTo !== 'string') {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'return_to is required and must be a non-empty string.' };
    }

    let parsed;
    try {
      parsed = new URL(returnTo.trim());
    } catch (_) {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'return_to is a malformed URL.' };
    }

    // Reject javascript:, data:, file:, etc.
    const protocol = parsed.protocol.toLowerCase();
    const isProduction = process.env.NODE_ENV === 'production';

    if (protocol !== 'https:' && protocol !== 'http:') {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'return_to protocol must be http or https.' };
    }

    // Require HTTPS in production
    if (isProduction && protocol !== 'https:') {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'HTTPS is strictly required for return_to in production.' };
    }

    const rawHostname = parsed.hostname.toLowerCase().trim();
    if (!rawHostname) {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'return_to hostname is missing.' };
    }

    // Reject localhost, loopback, or internal destinations in production
    const isLoopbackOrLocal = rawHostname === 'localhost' ||
      rawHostname === '127.0.0.1' ||
      rawHostname === '::1' ||
      rawHostname.endsWith('.local') ||
      rawHostname.endsWith('.internal');

    if (isProduction && isLoopbackOrLocal) {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'Localhost or loopback destinations are forbidden in production.' };
    }

    // Control plane cannot be a return_to client destination
    if (rawHostname === 'xentra.cloud') {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'Control-plane domain cannot be the return destination.' };
    }

    // Resolve hostname through authoritative BrandRepository / DomainRegistry
    const brand = this.brandRepository.findByCustomDomain(rawHostname);

    if (!brand) {
      throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'Destination domain is not registered in Xentra Domain Registry.' };
    }

    return {
      valid: true,
      url: parsed,
      hostname: rawHostname,
      brand
    };
  }

  /**
   * Creates a single-use, time-limited handoff ticket bound to a user and brand.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} [params.brandId]
   * @param {string} [params.returnTo]
   * @param {number} [params.ttlSeconds=60]
   * @returns {{ ticket: string, expires_at: string, redirect_url: string|null, brand_id: string, custom_domain: string|null }}
   */
  createTicket({ userId, brandId, returnTo, ttlSeconds = 60 }) {
    if (!userId || typeof userId !== 'string') {
      throw { status: 400, code: 'INVALID_USER_ID', message: 'User ID is required for handoff ticket creation.' };
    }

    let validatedReturn = null;
    let targetBrandId = brandId;

    if (returnTo) {
      validatedReturn = this.validateReturnTo(returnTo);
      if (targetBrandId && targetBrandId !== validatedReturn.brand.id) {
        throw { status: 400, code: 'INVALID_RETURN_DOMAIN', message: 'Resolved domain does not match target brand.' };
      }
      targetBrandId = validatedReturn.brand.id;
    }

    if (!targetBrandId || typeof targetBrandId !== 'string') {
      throw { status: 400, code: 'INVALID_BRAND_ID', message: 'Brand ID is required for handoff ticket creation.' };
    }

    // Verify user exists and has permission for this brand
    const user = this.db.prepare('SELECT id, brand_id, organization_id, role, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }
    if (user.status !== 'active') {
      throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'User account is not active.' };
    }

    // Verify target brand exists
    const brand = validatedReturn ? validatedReturn.brand : this.db.prepare('SELECT id, organization_id, custom_domain FROM brands WHERE id = ?').get(targetBrandId);
    if (!brand) {
      throw { status: 404, code: 'BRAND_NOT_FOUND', message: 'Target brand not found.' };
    }

    // Tenant / Organization authorization boundary:
    // Owner can access brands within their organization; others must match user.brand_id
    const isBrandAllowed = (user.brand_id === brand.id) ||
      (user.role === 'owner' && user.organization_id && user.organization_id === brand.organization_id);

    if (!isBrandAllowed) {
      throw { status: 403, code: 'FORBIDDEN_TENANT_ACCESS', message: 'User does not have access to the target brand.' };
    }

    // Generate cryptographically secure ticket code
    const ticketCode = 'xnt_hdf_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.tickets.set(ticketCode, {
      ticket: ticketCode,
      userId: user.id,
      brandId: brand.id,
      organizationId: brand.organization_id,
      role: user.role,
      expiresAt,
      used: false
    });

    // Compute redirect URL
    let redirectUrl = null;
    if (validatedReturn) {
      const returnUrlObj = new URL(validatedReturn.url.toString());
      returnUrlObj.searchParams.set('handoff', ticketCode);
      redirectUrl = returnUrlObj.toString();
    } else if (brand.custom_domain) {
      redirectUrl = `https://${brand.custom_domain}/dashboard/?handoff=${ticketCode}`;
    }

    return {
      ticket: ticketCode,
      expires_at: new Date(expiresAt).toISOString(),
      redirect_url: redirectUrl,
      brand_id: brand.id,
      custom_domain: brand.custom_domain || null
    };
  }

  /**
   * Consumes a handoff ticket and validates tenant binding.
   * Single-use only; immediately invalidated upon exchange.
   *
   * @param {Object} params
   * @param {string} params.ticket
   * @param {string} params.targetBrandId The brand ID resolved from the request host
   * @returns {{ user: Object, brandId: string, organizationId: string }}
   */
  consumeTicket({ ticket, targetBrandId }) {
    if (!ticket || typeof ticket !== 'string') {
      throw { status: 400, code: 'INVALID_TICKET', message: 'Handoff ticket is required.' };
    }
    if (!targetBrandId || typeof targetBrandId !== 'string') {
      throw { status: 400, code: 'INVALID_TARGET_BRAND', message: 'Target brand context is required.' };
    }

    const entry = this.tickets.get(ticket);
    if (!entry) {
      throw { status: 401, code: 'TICKET_NOT_FOUND', message: 'Handoff ticket not found or already consumed.' };
    }

    // Single-use check
    if (entry.used) {
      this.tickets.delete(ticket);
      throw { status: 401, code: 'TICKET_ALREADY_USED', message: 'Handoff ticket has already been used.' };
    }

    // Immediately mark used and delete
    entry.used = true;
    this.tickets.delete(ticket);

    // Expiry check
    if (Date.now() > entry.expiresAt) {
      throw { status: 401, code: 'TICKET_EXPIRED', message: 'Handoff ticket has expired.' };
    }

    // Brand/tenant binding enforcement: Target brand MUST match the brand ticket was created for
    if (entry.brandId !== targetBrandId) {
      throw {
        status: 403,
        code: 'TENANT_MISMATCH',
        message: 'Handoff ticket is not valid for this tenant domain.'
      };
    }

    // Fetch fresh user record
    const user = this.db.prepare(`
      SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status, email_verified_at
      FROM users
      WHERE id = ?
    `).get(entry.userId);

    if (!user || user.status !== 'active') {
      throw { status: 403, code: 'USER_INACTIVE', message: 'User account is inactive or not found.' };
    }

    return {
      user: {
        ...user,
        email_verified: Boolean(user.email_verified_at)
      },
      brandId: entry.brandId,
      organizationId: entry.organizationId
    };
  }
}

module.exports = HandoffService;
