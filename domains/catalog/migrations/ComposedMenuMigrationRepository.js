'use strict';

const DataAccess = require('../../../core/data/DataAccess');

const STATUSES = Object.freeze([
  'legacy',
  'needs_review',
  'migrated',
  'verified',
  'failed'
]);

function assertStatus(status) {
  const value = String(status || '').trim();
  if (!STATUSES.includes(value)) throw new Error('INVALID_COMPOSED_MIGRATION_STATUS');
  return value;
}

class ComposedMenuMigrationRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  find({ brandId, productId }) {
    return this.db.queryOne(
      'SELECT product_id, brand_id, source_model, target_model, status, attempt_count, ' +
      'canonical_fingerprint, source_snapshot, last_error, notes, migrated_at, verified_at, ' +
      'created_at, updated_at FROM composed_menu_migrations WHERE product_id = ? AND brand_id = ?',
      [productId, brandId]
    );
  }

  list({ brandId, status = null }) {
    const filter = status ? ' AND status = ?' : '';
    const params = status ? [brandId, assertStatus(status)] : [brandId];
    return this.db.queryMany(
      'SELECT product_id, brand_id, source_model, target_model, status, attempt_count, ' +
      'canonical_fingerprint, source_snapshot, last_error, notes, migrated_at, verified_at, ' +
      'created_at, updated_at FROM composed_menu_migrations WHERE brand_id = ?' + filter +
      ' ORDER BY updated_at DESC, product_id ASC',
      params
    );
  }

  record({
    brandId,
    productId,
    status,
    canonicalFingerprint = null,
    sourceSnapshot = null,
    lastError = null,
    notes = null,
    verified = false
  }) {
    const normalized = assertStatus(status);
    this.db.execute(
      'INSERT INTO composed_menu_migrations (' +
      'product_id, brand_id, source_model, target_model, status, attempt_count, canonical_fingerprint, ' +
      'source_snapshot, last_error, notes, migrated_at, verified_at, created_at, updated_at' +
      ') VALUES (?, ?, \'legacy_product\', \'composed_menu_v1\', ?, 1, ?, ?, ?, ?, ' +
      'CASE WHEN ? IN (\'migrated\', \'verified\') THEN datetime(\'now\') ELSE NULL END, ' +
      'CASE WHEN ? = 1 THEN datetime(\'now\') ELSE NULL END, datetime(\'now\'), datetime(\'now\')) ' +
      'ON CONFLICT(product_id) DO UPDATE SET ' +
      'brand_id = excluded.brand_id, target_model = excluded.target_model, status = excluded.status, ' +
      'attempt_count = composed_menu_migrations.attempt_count + 1, ' +
      'canonical_fingerprint = excluded.canonical_fingerprint, source_snapshot = excluded.source_snapshot, ' +
      'last_error = excluded.last_error, notes = excluded.notes, ' +
      'migrated_at = CASE WHEN excluded.status IN (\'migrated\', \'verified\') ' +
      'THEN COALESCE(composed_menu_migrations.migrated_at, datetime(\'now\')) ELSE composed_menu_migrations.migrated_at END, ' +
      'verified_at = CASE WHEN excluded.status = \'verified\' THEN datetime(\'now\') ELSE composed_menu_migrations.verified_at END, ' +
      'updated_at = datetime(\'now\')',
      [
        productId,
        brandId,
        normalized,
        canonicalFingerprint,
        sourceSnapshot,
        lastError,
        notes,
        normalized,
        verified ? 1 : 0
      ]
    );

    return this.find({ brandId, productId });
  }

  clearError({ brandId, productId }) {
    return this.db.execute(
      'UPDATE composed_menu_migrations SET last_error = NULL, updated_at = datetime(\'now\') ' +
      'WHERE product_id = ? AND brand_id = ?',
      [productId, brandId]
    );
  }
}

module.exports = {
  ComposedMenuMigrationRepository,
  STATUSES
};
