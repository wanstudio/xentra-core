'use strict';

const DataAccess = require('../../../core/data/DataAccess');
const MasterMenuCompositionRepository = require('../repositories/MasterMenuCompositionRepository').MasterMenuCompositionRepository;
const {
  ProductMenuMigrationRepository,
  STATUSES,
  canonicalFingerprint,
  TARGET_SCHEMA
} = require('../migrations/ProductMenuMigrationRepository');

const compositionRepository = new MasterMenuCompositionRepository();
const migrationRepository = new ProductMenuMigrationRepository();

function validateCanonicalComposition(product, composition) {
  const errors = [];
  if (!product) errors.push('MASTER_PRODUCT_NOT_FOUND');
  if (product && !product.category_id) errors.push('MASTER_CATEGORY_REQUIRED');
  if (!composition || !composition.category) errors.push('MASTER_CATEGORY_REQUIRED');

  const complements = Array.isArray(composition && composition.complements) ? composition.complements : [];
  if (complements.some((item, index) => Number(item.sort_order) !== index)) {
    errors.push('COMPLEMENT_ORDER_INVALID');
  }

  return errors;
}

function classifyLegacyProduct(product, composition) {
  const errors = validateCanonicalComposition(product, composition);
  if (errors.length) return { status: 'needs_review', errors };

  const hasStructuredRelations = !!(
    composition.flavor ||
    composition.level ||
    (composition.complements && composition.complements.length)
  );

  if (!hasStructuredRelations) {
    return {
      status: 'needs_review',
      errors: ['LEGACY_STRUCTURED_FIELDS_NOT_DETERMINISTIC'],
      notes: 'Master Category is available, but legacy data does not deterministically identify Flavor/Complement/Level. Free text is not auto-parsed.'
    };
  }

  return { status: 'migrated', errors: [] };
}

class ProductMenuMigrationService {
  static inspectProduct({ brandId, productId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!productId) throw new Error('MASTER_PRODUCT_REQUIRED');

    const product = DataAccess.queryOne(
      'SELECT id, brand_id, category_id, name, description, image_url, price, regular_price, ' +
      'is_active, menu_schema_version, menu_migration_status ' +
      'FROM products WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );

    if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');

    const composition = compositionRepository.findComposition({ brandId, productId });
    const migration = migrationRepository.find({ brandId, productId });

    return {
      product,
      composition,
      migration,
      canonical_fingerprint: canonicalFingerprint(composition),
      target_schema: TARGET_SCHEMA
    };
  }

  static reconcileProduct({ brandId, productId }) {
    const inspected = this.inspectProduct({ brandId, productId });
    const decision = classifyLegacyProduct(inspected.product, inspected.composition);
    const fingerprint = canonicalFingerprint(inspected.composition);

    if (decision.status === 'migrated') {
      const migration = migrationRepository.recordReconciliation({
        brandId,
        productId,
        status: 'migrated',
        canonicalFingerprint: fingerprint
      });
      return {
        product_id: productId,
        status: migration.status,
        schema_version: 2,
        errors: [],
        canonical_fingerprint: fingerprint
      };
    }

    const migration = migrationRepository.recordReconciliation({
      brandId,
      productId,
      status: 'needs_review',
      canonicalFingerprint: fingerprint,
      notes: decision.notes || decision.errors.join(', ')
    });

    return {
      product_id: productId,
      status: migration.status,
      schema_version: 1,
      errors: decision.errors,
      notes: decision.notes || null,
      canonical_fingerprint: fingerprint
    };
  }

  static verifyProduct({ brandId, productId }) {
    const inspected = this.inspectProduct({ brandId, productId });
    const errors = validateCanonicalComposition(inspected.product, inspected.composition);
    const hasStructuredRelations = !!(
      inspected.composition &&
      (inspected.composition.flavor ||
       inspected.composition.level ||
       (inspected.composition.complements && inspected.composition.complements.length))
    );

    // Verification is only allowed after the Product has entered the canonical
    // schema through a real composition save. A legacy Product with only its
    // existing Category must remain needs_review because its structured
    // Flavor/Complement/Level meaning cannot be recovered deterministically.
    if (!errors.length &&
        inspected.product.menu_schema_version !== 2 &&
        !hasStructuredRelations) {
      errors.push('MIGRATION_NOT_RECONCILED');
    }

    if (errors.length) {
      const migration = migrationRepository.recordReconciliation({
        brandId,
        productId,
        status: 'needs_review',
        canonicalFingerprint: inspected.canonical_fingerprint,
        notes: errors.join(', ')
      });
      return {
        product_id: productId,
        status: migration.status,
        schema_version: 1,
        errors
      };
    }

    const migration = migrationRepository.recordReconciliation({
      brandId,
      productId,
      status: 'verified',
      canonicalFingerprint: inspected.canonical_fingerprint
    });

    return {
      product_id: productId,
      status: migration.status,
      schema_version: 2,
      errors: []
    };
  }

  static reconcileBrand({ brandId, verify = false }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const products = DataAccess.queryMany(
      'SELECT id FROM products WHERE brand_id = ? ORDER BY sort_order ASC, name ASC, id ASC',
      [brandId]
    );

    const results = [];
    for (const product of products) {
      results.push(
        verify
          ? this.verifyProduct({ brandId, productId: product.id })
          : this.reconcileProduct({ brandId, productId: product.id })
      );
    }

    const summary = results.reduce((acc, item) => {
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, { total: 0, legacy: 0, needs_review: 0, migrated: 0, verified: 0, failed: 0 });

    return { brand_id: brandId, summary, results };
  }

  static listStatus({ brandId, status = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (status && !STATUSES.includes(status)) throw new Error('INVALID_MENU_MIGRATION_STATUS');
    return migrationRepository.list({ brandId, status });
  }
}

module.exports = {
  ProductMenuMigrationService,
  canonicalFingerprint,
  validateCanonicalComposition,
  classifyLegacyProduct,
  TARGET_SCHEMA,
  STATUSES
};
