'use strict';

/**
 * Tenant Domain Resolver (Canonical Tenant Resolution Engine)
 *
 * Resolves incoming HTTP hostname to authoritative tenant context using the
 * persistent domain registry (tenant_domains).
 *
 * Principles:
 * 1. Exact normalized hostname lookup (lowercase, trimmed, port-stripped).
 * 2. Strict multi-tenant security boundary: unknown, disabled, or unverified
 *    domains FAIL CLOSED (return null).
 * 3. Surface type is purely DATA-driven (surface_type: 'customer' | 'merchant' | 'pos')
 *    and NEVER determined by guessing hostname prefixes.
 * 4. Tenant isolation: Tenant A's domain will NEVER resolve Tenant B's context.
 */

const { TenantDomainRepository, BrandRepository } = require('../data/repositories');

class TenantDomainResolver {
  constructor({
    domainRepository = new TenantDomainRepository(),
    brandRepository = new BrandRepository()
  } = {}) {
    this.domainRepo = domainRepository;
    this.brandRepo = brandRepository;
  }

  async ready() {
    await this.domainRepo.ready();
    await this.brandRepo.ready();
    return this;
  }

  /**
   * Normalizes incoming hostname string.
   * Strips port, trims whitespace, converts to lowercase.
   *
   * @param {string} rawHost
   * @returns {string}
   */
  normalizeHostname(rawHost) {
    if (!rawHost || typeof rawHost !== 'string') return '';
    return rawHost.split(':')[0].trim().toLowerCase();
  }

  /**
   * Resolves authoritative tenant context from hostname.
   *
   * @param {string} rawHost - Hostname from req.headers.host or URL
   * @returns {Promise<Object|null>} Resolved context:
   *   {
   *     organization_id,
   *     brand_id,
   *     surface_type,
   *     hostname,
   *     is_primary,
   *     domain_record,
   *     brand
   *   } or null if not found/unauthorized/fail-closed
   */
  async resolve(rawHost) {
    const cleanHost = this.normalizeHostname(rawHost);
    if (!cleanHost) return null;

    // 1. Check persistent domain registry (tenant_domains)
    const domainRecord = this.domainRepo.findByHostname(cleanHost);

    if (domainRecord) {
      // Security Guard: Domain must be active and verified
      if (domainRecord.status !== 'active') {
        return null; // Disabled domain fails closed
      }
      if (domainRecord.verification_status !== 'verified') {
        return null; // Unverified domain fails closed
      }

      // Fetch brand record
      const brand = this.brandRepo.findById(domainRecord.brand_id);
      if (!brand) return null;

      return {
        organization_id: domainRecord.organization_id || brand.organization_id,
        brand_id: domainRecord.brand_id,
        surface_type: domainRecord.surface_type || 'customer',
        hostname: domainRecord.hostname,
        is_primary: Boolean(domainRecord.is_primary),
        domain_record: domainRecord,
        brand: brand
      };
    }

    // 2. Compatibility fallback: check brands.custom_domain directly
    const brand = this.brandRepo.findByCustomDomain(cleanHost);
    if (brand) {
      return {
        organization_id: brand.organization_id,
        brand_id: brand.id,
        surface_type: brand.surface_type || 'customer',
        hostname: cleanHost,
        is_primary: true,
        domain_record: null,
        brand: brand
      };
    }

    // Fail closed
    return null;
  }
}

module.exports = TenantDomainResolver;
