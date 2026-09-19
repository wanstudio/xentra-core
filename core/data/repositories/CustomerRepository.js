'use strict';

/**
 * Customer persistence adapter.
 *
 * Exposes customer identity and auth provider queries behind the DataAccess boundary.
 * Never leaks raw SQL or storage implementation to callers.
 */
const DataAccess = require('../DataAccess');

class CustomerRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findById(customerId) {
    return this.db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
  }

  /**
   * Operational search by brand and email (e.g. contact search).
   * NOTE: This is an operational helper, NOT a canonical identity or authorization resolver.
   */
  findByBrandAndEmail(brandId, email) {
    return this.db.queryOne(
      'SELECT * FROM customers WHERE brand_id = ? AND LOWER(email) = LOWER(?)',
      [brandId, String(email).trim()]
    );
  }

  /**
   * Operational search by brand and phone (e.g. contact search).
   * NOTE: This is an operational helper, NOT a canonical identity or authorization resolver.
   */
  findByBrandAndPhone(brandId, phone) {
    return this.db.queryOne(
      'SELECT * FROM customers WHERE brand_id = ? AND phone = ?',
      [brandId, String(phone).trim()]
    );
  }

  findAuthProvider(provider, providerUserId) {
    return this.db.queryOne(
      'SELECT * FROM customer_auth_providers WHERE provider = ? AND provider_user_id = ?',
      [String(provider).trim().toLowerCase(), String(providerUserId).trim()]
    );
  }

  findCustomerWithProvider(provider, providerUserId) {
    return this.db.queryOne(`
      SELECT 
        c.id,
        c.organization_id,
        c.brand_id,
        c.display_name,
        c.email,
        c.phone,
        c.created_at,
        c.updated_at,
        cap.id as auth_provider_id,
        cap.provider,
        cap.provider_user_id,
        cap.email as provider_email,
        cap.metadata as provider_metadata,
        cap.linked_at
      FROM customer_auth_providers cap
      JOIN customers c ON cap.customer_id = c.id
      WHERE cap.provider = ? AND cap.provider_user_id = ?
    `, [String(provider).trim().toLowerCase(), String(providerUserId).trim()]);
  }

  insertCustomer({ id, organizationId, brandId, displayName, email, phone, createdAt, updatedAt }) {
    return this.db.execute(`
      INSERT INTO customers (id, organization_id, brand_id, display_name, email, phone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      organizationId,
      brandId,
      displayName || null,
      email ? String(email).trim().toLowerCase() : null,
      phone ? String(phone).trim() : null,
      createdAt || new Date().toISOString(),
      updatedAt || new Date().toISOString()
    ]);
  }

  insertAuthProvider({ id, customerId, provider, providerUserId, email, metadata, linkedAt, createdAt, updatedAt }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO customer_auth_providers (
        id, customer_id, provider, provider_user_id, email, metadata, linked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      customerId,
      String(provider).trim().toLowerCase(),
      String(providerUserId).trim(),
      email ? String(email).trim().toLowerCase() : null,
      metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
      linkedAt || now,
      createdAt || now,
      updatedAt || now
    ]);
  }

  updateCustomerProfile(customerId, { displayName, email, phone, updatedAt }) {
    const sets = [];
    const params = [];

    if (displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(displayName);
    }
    if (email !== undefined) {
      sets.push('email = ?');
      params.push(email ? String(email).trim().toLowerCase() : null);
    }
    if (phone !== undefined) {
      sets.push('phone = ?');
      params.push(phone ? String(phone).trim() : null);
    }

    sets.push('updated_at = ?');
    params.push(updatedAt || new Date().toISOString());

    params.push(customerId);

    return this.db.execute(`
      UPDATE customers
      SET ${sets.join(', ')}
      WHERE id = ?
    `, params);
  }

  updateAuthProviderEmail(providerLinkId, email, updatedAt) {
    return this.db.execute(`
      UPDATE customer_auth_providers
      SET email = ?, updated_at = ?
      WHERE id = ?
    `, [
      email ? String(email).trim().toLowerCase() : null,
      updatedAt || new Date().toISOString(),
      providerLinkId
    ]);
  }
}

module.exports = CustomerRepository;
