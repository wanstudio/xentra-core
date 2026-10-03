'use strict';

/**
 * Tenant Domain persistence adapter.
 *
 * Exposes persistent domain registry reads and writes behind the DataAccess boundary.
 * Authoritative system of record for hostname -> tenant mapping, verification lifecycle,
 * and surface definitions (customer, merchant, pos).
 */
const DataAccess = require('../DataAccess');

class TenantDomainRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  async ready() {
    await this.db.ready();
    return this;
  }

  /**
   * Find domain record by exact normalized hostname.
   * Hostname is normalized to lowercase and trimmed.
   *
   * @param {string} hostname
   * @returns {Object|undefined}
   */
  findByHostname(hostname) {
    if (!hostname || typeof hostname !== 'string') return undefined;
    const clean = hostname.trim().toLowerCase();
    return this.db.queryOne(`
      SELECT *
      FROM tenant_domains
      WHERE LOWER(TRIM(hostname)) = ?
      LIMIT 1
    `, [clean]);
  }

  /**
   * Find domain by primary key ID.
   *
   * @param {string} id
   * @returns {Object|undefined}
   */
  findById(id) {
    if (!id || typeof id !== 'string') return undefined;
    return this.db.queryOne('SELECT * FROM tenant_domains WHERE id = ? LIMIT 1', [id.trim()]);
  }

  /**
   * Find all domains for a given brand.
   *
   * @param {string} brandId
   * @returns {Array<Object>}
   */
  findByBrandId(brandId) {
    if (!brandId) return [];
    return this.db.queryMany(`
      SELECT *
      FROM tenant_domains
      WHERE brand_id = ?
      ORDER BY is_primary DESC, created_at ASC
    `, [brandId]);
  }

  /**
   * Find all domains for a given organization.
   *
   * @param {string} organizationId
   * @returns {Array<Object>}
   */
  findByOrganizationId(organizationId) {
    if (!organizationId) return [];
    return this.db.queryMany(`
      SELECT *
      FROM tenant_domains
      WHERE organization_id = ?
      ORDER BY is_primary DESC, created_at ASC
    `, [organizationId]);
  }

  /**
   * List all domains with optional filters.
   *
   * @param {Object} [filter]
   * @param {string} [filter.brand_id]
   * @param {string} [filter.organization_id]
   * @param {string} [filter.status]
   * @param {string} [filter.surface_type]
   * @returns {Array<Object>}
   */
  findAll(filter = {}) {
    const conditions = [];
    const params = [];

    if (filter.brand_id) {
      conditions.push('brand_id = ?');
      params.push(filter.brand_id);
    }
    if (filter.organization_id) {
      conditions.push('organization_id = ?');
      params.push(filter.organization_id);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.surface_type) {
      conditions.push('surface_type = ?');
      params.push(filter.surface_type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.queryMany(`
      SELECT *
      FROM tenant_domains
      ${where}
      ORDER BY created_at DESC
    `, params);
  }

  /**
   * Create a new tenant domain record.
   *
   * @param {Object} data
   * @returns {Object} created record
   */
  create(data) {
    const cleanHostname = (data.hostname || '').trim().toLowerCase();
    if (!cleanHostname) {
      throw new Error('[TenantDomainRepository] Hostname is required.');
    }
    if (!data.organization_id || !data.brand_id) {
      throw new Error('[TenantDomainRepository] organization_id and brand_id are required.');
    }
    const surfaceType = (data.surface_type || 'customer').trim().toLowerCase();
    const validSurfaces = ['customer', 'merchant', 'pos'];
    if (!validSurfaces.includes(surfaceType)) {
      throw new Error(`[TenantDomainRepository] Invalid surface_type "${surfaceType}". Allowed: ${validSurfaces.join(', ')}`);
    }

    const id = data.id || `td_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const isPrimary = data.is_primary ? 1 : 0;
    const verificationStatus = data.verification_status || 'pending';
    const verificationMethod = data.verification_method || 'dns_txt';
    const verificationToken = data.verification_token || `xnt_challenge_${Math.random().toString(36).substring(2, 14)}`;
    const provisioningStatus = data.provisioning_status || 'unprovisioned';
    const tlsStatus = data.tls_status || 'pending';
    const status = data.status || 'active';

    this.db.execute(`
      INSERT INTO tenant_domains (
        id, hostname, organization_id, brand_id, surface_type, is_primary,
        verification_status, verification_method, verification_token,
        provisioning_status, tls_status, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      id,
      cleanHostname,
      data.organization_id,
      data.brand_id,
      surfaceType,
      isPrimary,
      verificationStatus,
      verificationMethod,
      verificationToken,
      provisioningStatus,
      tlsStatus,
      status
    ]);

    return this.findById(id);
  }

  /**
   * Update mutable fields of a tenant domain record.
   *
   * @param {string} id
   * @param {Object} updates
   * @returns {Object|undefined} updated record
   */
  update(id, updates = {}) {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const fields = [];
    const params = [];

    if (updates.surface_type !== undefined) {
      const surfaceType = String(updates.surface_type).trim().toLowerCase();
      if (!['customer', 'merchant', 'pos'].includes(surfaceType)) {
        throw new Error(`[TenantDomainRepository] Invalid surface_type "${surfaceType}".`);
      }
      fields.push('surface_type = ?');
      params.push(surfaceType);
    }
    if (updates.is_primary !== undefined) {
      fields.push('is_primary = ?');
      params.push(updates.is_primary ? 1 : 0);
    }
    if (updates.verification_status !== undefined) {
      fields.push('verification_status = ?');
      params.push(updates.verification_status);
    }
    if (updates.verification_method !== undefined) {
      fields.push('verification_method = ?');
      params.push(updates.verification_method);
    }
    if (updates.verification_token !== undefined) {
      fields.push('verification_token = ?');
      params.push(updates.verification_token);
    }
    if (updates.provisioning_status !== undefined) {
      fields.push('provisioning_status = ?');
      params.push(updates.provisioning_status);
    }
    if (updates.tls_status !== undefined) {
      fields.push('tls_status = ?');
      params.push(updates.tls_status);
    }
    if (updates.status !== undefined) {
      const status = String(updates.status).trim().toLowerCase();
      if (!['active', 'disabled'].includes(status)) {
        throw new Error(`[TenantDomainRepository] Invalid status "${status}". Allowed: active, disabled.`);
      }
      fields.push('status = ?');
      params.push(status);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    params.push(id);

    this.db.execute(`
      UPDATE tenant_domains
      SET ${fields.join(', ')}
      WHERE id = ?
    `, params);

    return this.findById(id);
  }

  /**
   * Delete a tenant domain record by ID.
   *
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    const res = this.db.execute('DELETE FROM tenant_domains WHERE id = ?', [id]);
    return (res && res.changes > 0);
  }
}

module.exports = TenantDomainRepository;
