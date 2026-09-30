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

function normalizeLegacyMenuText(value) {
  return String(value == null ? '' : value).toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[+|,_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseMatches(text, phrase) {
  const source = normalizeLegacyMenuText(text);
  const target = normalizeLegacyMenuText(phrase);
  if (!source || !target || target.length < 3) return false;
  return (' ' + source + ' ').includes(' ' + target + ' ');
}

function rankMatches(text, rows) {
  return (rows || []).filter(row => row && row.name && row.is_active !== 0 && phraseMatches(text, row.name))
    .map(row => ({ row, length: normalizeLegacyMenuText(row.name).length }))
    .sort((a, b) => b.length - a.length || String(a.row.id).localeCompare(String(b.row.id)));
}

function deterministicSingleMatch(text, rows) {
  const matches = rankMatches(text, rows);
  if (!matches.length) return { row: null, ambiguous: false, candidates: [] };
  const topLength = matches[0].length;
  const top = matches.filter(item => item.length === topLength);
  return {
    row: top.length === 1 ? top[0].row : null,
    ambiguous: top.length > 1,
    candidates: matches.map(item => item.row)
  };
}

function buildDeterministicLegacyMapping(productName, components) {
  const flavor = deterministicSingleMatch(productName, components.flavor);
  const level = deterministicSingleMatch(productName, components.level);
  const excluded = new Set();
  if (flavor.row) excluded.add(String(flavor.row.id));
  if (level.row) excluded.add(String(level.row.id));
  const complements = rankMatches(productName, components.complement)
    .filter(item => !excluded.has(String(item.row.id)))
    .map(item => item.row);
  const errors = [];
  if (flavor.ambiguous) errors.push('AMBIGUOUS_FLAVOR_MATCH');
  if (level.ambiguous) errors.push('AMBIGUOUS_LEVEL_MATCH');
  if (!flavor.row && !level.row && complements.length === 0 && errors.length === 0) {
    errors.push('LEGACY_STRUCTURED_FIELDS_NOT_DETERMINISTIC');
  }
  return {
    flavor_id: flavor.row ? String(flavor.row.id) : null,
    complement_ids: complements.map(row => String(row.id)),
    level_id: level.row ? String(level.row.id) : null,
    errors,
    candidates: { flavor: flavor.candidates, level: level.candidates, complements }
  };
}

function validateCanonicalComposition(product, composition) {
  const errors = [];
  if (!product) errors.push('MASTER_PRODUCT_NOT_FOUND');
  if (product && !product.category_id) errors.push('MASTER_CATEGORY_REQUIRED');
  if (!composition || !composition.category) errors.push('MASTER_CATEGORY_REQUIRED');
  const complements = Array.isArray(composition && composition.complements) ? composition.complements : [];
  if (complements.some((item, index) => Number(item.sort_order) !== index)) errors.push('COMPLEMENT_ORDER_INVALID');
  return errors;
}

function validateCanonicalReferenceIntegrity({ brandId, productId }) {
  const errors = [];

  const category = DataAccess.queryOne(
    'SELECT p.category_id, c.id, c.brand_id FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.brand_id = ?',
    [productId, brandId]
  );
  if (category && category.category_id && (!category.id || category.brand_id !== brandId)) {
    errors.push('MASTER_CATEGORY_BRAND_MISMATCH');
  }

  const flavorMismatch = DataAccess.queryOne(
    'SELECT COUNT(*) AS count FROM product_flavors pf LEFT JOIN menu_flavors mf ON mf.id = pf.flavor_id WHERE pf.product_id = ? AND (mf.id IS NULL OR mf.brand_id != ?)',
    [productId, brandId]
  );
  if (Number(flavorMismatch && flavorMismatch.count) > 0) errors.push('MASTER_FLAVOR_BRAND_MISMATCH');

  const complementMismatch = DataAccess.queryOne(
    'SELECT COUNT(*) AS count FROM product_complements pc LEFT JOIN menu_complements mc ON mc.id = pc.complement_id WHERE pc.product_id = ? AND (mc.id IS NULL OR mc.brand_id != ?)',
    [productId, brandId]
  );
  if (Number(complementMismatch && complementMismatch.count) > 0) errors.push('MASTER_COMPLEMENT_BRAND_MISMATCH');

  const levelMismatch = DataAccess.queryOne(
    'SELECT COUNT(*) AS count FROM product_levels pl LEFT JOIN menu_levels ml ON ml.id = pl.level_id WHERE pl.product_id = ? AND (ml.id IS NULL OR ml.brand_id != ?)',
    [productId, brandId]
  );
  if (Number(levelMismatch && levelMismatch.count) > 0) errors.push('MASTER_LEVEL_BRAND_MISMATCH');

  return errors;
}

function classifyLegacyProduct(product, composition, mapping) {
  const errors = validateCanonicalComposition(product, composition);
  if (errors.length) return { status: 'needs_review', errors };
  if (composition && (composition.flavor || composition.level || (composition.complements && composition.complements.length))) {
    return { status: 'migrated', errors: [], reason: 'CANONICAL_COMPOSITION_ALREADY_PRESENT' };
  }
  if (!mapping || mapping.errors.length) {
    return {
      status: 'needs_review',
      errors: (mapping && mapping.errors) || ['LEGACY_STRUCTURED_FIELDS_NOT_DETERMINISTIC'],
      notes: 'Legacy Product requires Owner review before canonical composition can be written.'
    };
  }
  return { status: 'candidate', errors: [], reason: 'DETERMINISTIC_LEGACY_NAME_MATCH' };
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

  static loadMasterComponents({ brandId }) {
    return {
      flavor: compositionRepository.listComponents({ brandId, type: 'flavor', activeOnly: true }),
      complement: compositionRepository.listComponents({ brandId, type: 'complement', activeOnly: true }),
      level: compositionRepository.listComponents({ brandId, type: 'level', activeOnly: true })
    };
  }

  static planProductMigration({ brandId, productId, components = null }) {
    const inspected = this.inspectProduct({ brandId, productId });

    if (Number(inspected.product.menu_schema_version) === 2) {
      const canonicalErrors = [
        ...validateCanonicalComposition(inspected.product, inspected.composition),
        ...validateCanonicalReferenceIntegrity({ brandId, productId })
      ];
      const canonicalStatus = inspected.product.menu_migration_status === 'verified' && canonicalErrors.length === 0
        ? 'verified'
        : canonicalErrors.length
          ? 'needs_review'
          : 'migrated';
      return {
        product_id: productId,
        product_name: inspected.product.name,
        current_status: inspected.product.menu_migration_status,
        current_schema_version: 2,
        status: canonicalStatus,
        errors: canonicalErrors,
        notes: canonicalErrors.length ? 'Canonical schema marker exists but canonical composition requires review.' : null,
        reason: canonicalErrors.length ? 'CANONICAL_COMPOSITION_INVALID' : 'ALREADY_CANONICAL',
        canonical_fingerprint: inspected.canonical_fingerprint,
        source: { name: inspected.product.name },
        suggested_composition: {
          category_id: inspected.product.category_id || null,
          flavor_id: inspected.composition && inspected.composition.flavor ? String(inspected.composition.flavor.id) : null,
          complement_ids: inspected.composition && inspected.composition.complements
            ? inspected.composition.complements.map(row => String(row.id))
            : [],
          level_id: inspected.composition && inspected.composition.level ? String(inspected.composition.level.id) : null
        },
        matches: { flavor: [], level: [], complements: [] }
      };
    }

    const masterComponents = components || this.loadMasterComponents({ brandId });
    const mapping = buildDeterministicLegacyMapping(inspected.product.name, masterComponents);
    const decision = classifyLegacyProduct(inspected.product, inspected.composition, mapping);
    return {
      product_id: productId,
      product_name: inspected.product.name,
      current_status: inspected.product.menu_migration_status,
      current_schema_version: inspected.product.menu_schema_version,
      status: decision.status,
      errors: decision.errors,
      notes: decision.notes || null,
      reason: decision.reason || null,
      canonical_fingerprint: inspected.canonical_fingerprint,
      source: { name: inspected.product.name },
      suggested_composition: {
        category_id: inspected.product.category_id || null,
        flavor_id: mapping.flavor_id,
        complement_ids: mapping.complement_ids,
        level_id: mapping.level_id
      },
      matches: mapping.candidates
    };
  }

  static applyProductMigration({ brandId, productId, components = null }) {
    const plan = this.planProductMigration({ brandId, productId, components });
    if (plan.status === 'migrated') return Object.assign(plan, { applied: false, reason: 'ALREADY_MIGRATED' });
    if (plan.status !== 'candidate') {
      migrationRepository.recordReconciliation({
        brandId, productId, status: 'needs_review',
        canonicalFingerprint: plan.canonical_fingerprint,
        notes: plan.notes || plan.errors.join(', ')
      });
      return Object.assign(plan, { applied: false });
    }

    const composition = compositionRepository.replaceComposition({
      brandId,
      productId,
      categoryId: plan.suggested_composition.category_id,
      flavorId: plan.suggested_composition.flavor_id,
      complementIds: plan.suggested_composition.complement_ids,
      levelId: plan.suggested_composition.level_id
    });
    return Object.assign(plan, {
      status: 'migrated',
      applied: true,
      composition,
      canonical_fingerprint: canonicalFingerprint(composition)
    });
  }

  static reconcileProduct({ brandId, productId, apply = false, persistReport = apply, components = null }) {
    const plan = this.planProductMigration({ brandId, productId, components });
    if (plan.status === 'candidate' && apply) {
      return this.applyProductMigration({ brandId, productId, components });
    }

    if (!persistReport || plan.status === 'verified') {
      return Object.assign(plan, {
        applied: false,
        persisted: false,
        status: plan.status === 'candidate' ? 'candidate' : plan.status
      });
    }

    const targetStatus = plan.status === 'candidate' ? 'needs_review' : plan.status;
    const migration = migrationRepository.recordReconciliation({
      brandId, productId, status: targetStatus,
      canonicalFingerprint: plan.canonical_fingerprint,
      notes: plan.notes || plan.errors.join(', ') || plan.reason
    });
    return Object.assign(plan, {
      status: migration.status,
      applied: false,
      persisted: true
    });
  }
  static verifyProduct({ brandId, productId }) {
    const inspected = this.inspectProduct({ brandId, productId });
    const errors = [
      ...validateCanonicalComposition(inspected.product, inspected.composition),
      ...validateCanonicalReferenceIntegrity({ brandId, productId })
    ];
    // Verification is only allowed after the Product has entered the canonical
    // schema through reconciliation or a real composition save. A legacy
    // Product must never jump directly to verified.
    if (!errors.length && inspected.product.menu_schema_version !== 2) {
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

  static reconcileBrand({ brandId, verify = false, apply = false, persistReport = apply }) {
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
          : this.reconcileProduct({ brandId, productId: product.id, apply, persistReport })
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
  normalizeLegacyMenuText,
  phraseMatches,
  deterministicSingleMatch,
  buildDeterministicLegacyMapping,
  canonicalFingerprint,
  validateCanonicalComposition,
  classifyLegacyProduct,
  TARGET_SCHEMA,
  STATUSES
};
