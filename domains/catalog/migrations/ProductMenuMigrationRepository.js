'use strict';

const DataAccess = require('../../../core/data/DataAccess');

function canonicalFingerprintFor(composition) { return canonicalFingerprint(composition); }

const STATUSES = Object.freeze(['legacy', 'needs_review', 'migrated', 'verified', 'failed']);
const TARGET_SCHEMA = 'master-menu-composition-v1';

function canonicalFingerprint(composition) {
  const normalized = {
    product_id: String(composition && composition.product_id || ''),
    category: composition && composition.category ? {
      id: String(composition.category.id),
      name: String(composition.category.name || ''),
      slug: String(composition.category.slug || '')
    } : null,
    flavor: composition && composition.flavor ? {
      id: String(composition.flavor.id),
      name: String(composition.flavor.name || ''),
      slug: String(composition.flavor.slug || '')
    } : null,
    complements: Array.isArray(composition && composition.complements)
      ? composition.complements.map((item, index) => ({
          id: String(item.id),
          name: String(item.name || ''),
          slug: String(item.slug || ''),
          sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index
        }))
      : [],
    level: composition && composition.level ? {
      id: String(composition.level.id),
      name: String(composition.level.name || ''),
      slug: String(composition.level.slug || '')
    } : null
  };
  return require('crypto').createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function assertStatus(status) {
  const value = String(status || '').trim();
  if (!STATUSES.includes(value)) throw new Error('INVALID_MENU_MIGRATION_STATUS');
  return value;
}

class ProductMenuMigrationRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  find({ brandId, productId }) {
    return this.db.queryOne(
      'SELECT product_id, brand_id, source_schema, target_schema, status, ' +
      'attempt_count, canonical_fingerprint, last_error, notes, ' +
      'migrated_at, verified_at, created_at, updated_at ' +
      'FROM product_menu_migrations WHERE product_id = ? AND brand_id = ?',
      [productId, brandId]
    );
  }

  list({ brandId, status = null }) {
    const statusFilter = status ? 'AND p.menu_migration_status = ?' : '';
    const params = status ? [brandId, assertStatus(status)] : [brandId];
    return this.db.queryMany(
      'SELECT p.id AS product_id, p.brand_id, p.name, p.category_id, ' +
      'p.menu_schema_version, p.menu_migration_status, ' +
      'm.source_schema, m.target_schema, m.status AS migration_status, ' +
      'm.attempt_count, m.canonical_fingerprint, m.last_error, ' +
      'm.notes, m.migrated_at, m.verified_at, ' +
      'm.created_at AS migration_created_at, m.updated_at AS migration_updated_at ' +
      'FROM products p ' +
      'LEFT JOIN product_menu_migrations m ON m.product_id = p.id AND m.brand_id = p.brand_id ' +
      'WHERE p.brand_id = ? ' + statusFilter +
      ' ORDER BY p.sort_order ASC, p.name ASC, p.id ASC',
      params
    );
  }

  recordCanonicalSaved({ brandId, productId, composition, canonicalFingerprint: suppliedFingerprint = null, notes = null }) {
    const canonicalFingerprint = suppliedFingerprint || canonicalFingerprintFor(composition);
    const current = this.db.queryOne(
      'SELECT menu_schema_version FROM products WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );
    const sourceSchema = current && Number(current.menu_schema_version) === 2
      ? TARGET_SCHEMA
      : 'legacy';

    this.db.execute(
      'INSERT INTO product_menu_migrations (' +
      'product_id, brand_id, source_schema, target_schema, status, ' +
      'attempt_count, canonical_fingerprint, last_error, notes, ' +
      'migrated_at, verified_at, created_at, updated_at' +
      ') VALUES (?, ?, ?, ?, \'migrated\', 1, ?, NULL, ?, datetime(\'now\'), NULL, datetime(\'now\'), datetime(\'now\')) ' +
      'ON CONFLICT(product_id) DO UPDATE SET ' +
      'brand_id = excluded.brand_id, source_schema = excluded.source_schema, ' +
      'target_schema = excluded.target_schema, status = \'migrated\', ' +
      'attempt_count = product_menu_migrations.attempt_count + 1, ' +
      'canonical_fingerprint = excluded.canonical_fingerprint, last_error = NULL, ' +
      'notes = excluded.notes, migrated_at = datetime(\'now\'), verified_at = NULL, ' +
      'updated_at = datetime(\'now\')',
      [productId, brandId, sourceSchema, TARGET_SCHEMA, canonicalFingerprint, notes]
    );

    this.db.execute(
      'UPDATE products SET menu_schema_version = 2, menu_migration_status = \'migrated\', ' +
      'updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );

    return this.find({ brandId, productId });
  }

  recordReconciliation({ brandId, productId, status, canonicalFingerprint = null, lastError = null, notes = null }) {
    const normalizedStatus = assertStatus(status);
    const current = this.db.queryOne(
      'SELECT menu_schema_version FROM products WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );
    const sourceSchema = current && Number(current.menu_schema_version) === 2
      ? TARGET_SCHEMA
      : 'legacy';
    const migratedAt = normalizedStatus === 'migrated' ? 'datetime(\'now\')' : 'NULL';
    const verifiedAt = normalizedStatus === 'verified' ? 'datetime(\'now\')' : 'NULL';
    const version = normalizedStatus === 'migrated' || normalizedStatus === 'verified' ? 2 : 1;

    this.db.execute(
      'INSERT INTO product_menu_migrations (' +
      'product_id, brand_id, source_schema, target_schema, status, ' +
      'attempt_count, canonical_fingerprint, last_error, notes, migrated_at, verified_at, created_at, updated_at' +
      ') VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ' + migratedAt + ', ' + verifiedAt + ', datetime(\'now\'), datetime(\'now\')) ' +
      'ON CONFLICT(product_id) DO UPDATE SET ' +
      'brand_id = excluded.brand_id, source_schema = excluded.source_schema, ' +
      'target_schema = excluded.target_schema, status = excluded.status, ' +
      'attempt_count = product_menu_migrations.attempt_count + 1, ' +
      'canonical_fingerprint = excluded.canonical_fingerprint, last_error = excluded.last_error, ' +
      'notes = excluded.notes, migrated_at = excluded.migrated_at, verified_at = excluded.verified_at, ' +
      'updated_at = datetime(\'now\')',
      [productId, brandId, sourceSchema, TARGET_SCHEMA, normalizedStatus, canonicalFingerprint, lastError, notes]
    );

    this.db.execute(
      'UPDATE products SET menu_schema_version = ?, menu_migration_status = ?, updated_at = datetime(\'now\') ' +
      'WHERE id = ? AND brand_id = ?',
      [version, normalizedStatus, productId, brandId]
    );

    return this.find({ brandId, productId });
  }
}

module.exports = {
  ProductMenuMigrationRepository,
  STATUSES,
  TARGET_SCHEMA,
  assertStatus,
  canonicalFingerprint
};
