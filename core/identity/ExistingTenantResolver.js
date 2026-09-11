'use strict';

const db = require('../../server/database/db');

class ExistingTenantResolver {
  constructor(database = db) {
    this.db = database;
  }

  /**
   * Normalizes an incoming hostname or domain input.
   * Strips protocol (https:// or http://), whitespace, path, and port.
   *
   * @param {string} domainInput
   * @returns {string} Clean hostname
   */
  normalizeDomain(domainInput) {
    if (!domainInput || typeof domainInput !== 'string') {
      return '';
    }
    let cleaned = domainInput.trim().toLowerCase();
    cleaned = cleaned.replace(/^(?:https?:\/\/)?/i, '');
    cleaned = cleaned.split('/')[0];
    cleaned = cleaned.split(':')[0];
    return cleaned.trim();
  }

  /**
   * Resolves an existing tenant by domain.
   * Checks `brands.custom_domain` strictly without exposing sensitive internal keys.
   *
   * @param {string} domainInput
   * @returns {Object|null} Found business info or null
   */
  resolveByDomain(domainInput) {
    const cleanDomain = this.normalizeDomain(domainInput);
    if (!cleanDomain) {
      return null;
    }

    // Never treat control plane itself as a claimable tenant
    if (cleanDomain === 'xentra.cloud' || cleanDomain === 'localhost' || cleanDomain === '127.0.0.1') {
      return null;
    }

    const brand = this.db.prepare(`
      SELECT b.id, b.organization_id, b.name, b.slug, b.logo_url, b.custom_domain,
             o.name as organization_name
      FROM brands b
      LEFT JOIN organizations o ON b.organization_id = o.id
      WHERE lower(trim(b.custom_domain)) = ?
      LIMIT 1
    `).get(cleanDomain);

    if (!brand) {
      return null;
    }

    // Count branches to enrich business summary without exposing IDs
    const branchCountRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM branches WHERE brand_id = ?'
    ).get(brand.id);

    return {
      found: true,
      brand_id: brand.id,
      organization_id: brand.organization_id,
      business_name: brand.name,
      organization_name: brand.organization_name || brand.name,
      custom_domain: brand.custom_domain,
      logo_url: brand.logo_url || null,
      branch_count: branchCountRow ? branchCountRow.cnt : 1
    };
  }
}

module.exports = ExistingTenantResolver;
