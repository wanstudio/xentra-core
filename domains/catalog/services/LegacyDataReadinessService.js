'use strict';

/**
 * Read-only inventory of legacy Product-centric data that still blocks
 * retirement of compatibility endpoints/fields.
 *
 * Contract:
 * - SELECT only. This service MUST NOT mutate canonical or legacy tables.
 * - Product remains the inventory identity; Menu is the commercial authority.
 * - A legacy Product reference is migration-ready only when it maps to exactly
 *   one canonical Menu in the relevant scope. Zero or multiple candidates
 *   require review.
 */
const DataAccess = require('../../../core/data/DataAccess');

const STATUS = Object.freeze({
  CANONICAL_READY: 'CANONICAL_READY',
  LEGACY_REQUIRES_MIGRATION: 'LEGACY_REQUIRES_MIGRATION',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  BLOCKED: 'BLOCKED'
});

function scopeSql(alias, brandId, params) {
  if (!brandId) return '';
  params.push(brandId);
  return ` AND ${alias}.brand_id = ?`;
}

function nonEmpty(column) {
  return `(${column} IS NOT NULL AND trim(CAST(${column} AS TEXT)) <> '')`;
}

class LegacyDataReadinessService {
  static inspect({ brandId = null, includeRows = true, limit = 100, dataAccess = DataAccess } = {}) {
    const productStatusParams = [];
    const brandScopeProduct = scopeSql('p', brandId, productStatusParams);

    const productStatus = dataAccess.queryMany(`
      SELECT
        p.menu_migration_status AS status,
        p.menu_schema_version AS schema_version,
        COUNT(*) AS count
      FROM products p
      WHERE 1=1 ${brandScopeProduct}
      GROUP BY p.menu_migration_status, p.menu_schema_version
      ORDER BY p.menu_migration_status ASC, p.menu_schema_version ASC
    `, productStatusParams);

    const productCoverageParams = [];
    const productScope = scopeSql('p', brandId, productCoverageParams);
    const productCoverage = dataAccess.queryOne(`
      SELECT
        COUNT(*) AS total_products,
        COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN p.id END) AS products_with_canonical_menu,
        COUNT(DISTINCT CASE WHEN m.id IS NULL THEN p.id END) AS products_without_canonical_menu,
        COUNT(DISTINCT m.id) AS canonical_menu_count
      FROM products p
      LEFT JOIN menu_items mi ON mi.product_id = p.id
      LEFT JOIN menus m ON m.id = mi.menu_id AND m.brand_id = p.brand_id
      WHERE 1=1 ${productScope}
    `, productCoverageParams);

    const promotionParams = [];
    const promotionScope = scopeSql('p', brandId, promotionParams);
    const legacyPromotions = dataAccess.queryMany(`
      SELECT
        pr.promotion_id,
        p.name AS promotion_name,
        pr.target_product_id,
        COUNT(DISTINCT CASE
          WHEN m.brand_id = p.brand_id THEN mi.menu_id
        END) AS canonical_menu_candidates
      FROM promotion_rewards pr
      JOIN promotions p ON p.id = pr.promotion_id
      LEFT JOIN menu_items mi ON mi.product_id = pr.target_product_id
      LEFT JOIN menus m ON m.id = mi.menu_id
      WHERE ${nonEmpty('pr.target_product_id')}
        AND (pr.target_menu_id IS NULL OR trim(CAST(pr.target_menu_id AS TEXT)) = '')
        ${promotionScope}
      GROUP BY pr.promotion_id, p.name, p.brand_id, pr.target_product_id
      ORDER BY p.name ASC, pr.target_product_id ASC
    `, promotionParams);

    const branchParams = [];
    const branchScope = scopeSql('b', brandId, branchParams);
    const legacyBranches = dataAccess.queryMany(`
      SELECT
        bp.branch_id,
        b.name AS branch_name,
        bp.product_id,
        p.name AS product_name,
        COUNT(DISTINCT CASE
          WHEN m.brand_id = b.brand_id THEN bm.menu_id
        END) AS canonical_menu_candidates
      FROM branch_products bp
      JOIN branches b ON b.id = bp.branch_id
      JOIN products p ON p.id = bp.product_id AND p.brand_id = b.brand_id
      LEFT JOIN menu_items mi ON mi.product_id = bp.product_id
      LEFT JOIN menus m ON m.id = mi.menu_id
      LEFT JOIN branch_menus bm
        ON bm.menu_id = mi.menu_id
       AND bm.branch_id = bp.branch_id
      WHERE 1=1 ${branchScope}
      GROUP BY bp.branch_id, b.name, b.brand_id, bp.product_id, p.name
      HAVING COUNT(DISTINCT CASE
        WHEN m.brand_id = b.brand_id THEN bm.menu_id
      END) <> 1
      ORDER BY b.name ASC, p.name ASC, bp.product_id ASC
    `, branchParams);

    const branchProductTotalParams = [];
    const branchProductTotalScope = scopeSql('b', brandId, branchProductTotalParams);
    const branchProductTotals = dataAccess.queryOne(`
      SELECT COUNT(*) AS total_legacy_branch_products
      FROM branch_products bp
      JOIN branches b ON b.id = bp.branch_id
      WHERE 1=1 ${branchProductTotalScope}
    `, branchProductTotalParams);

    const branchCategoryParams = [];
    const branchCategoryScope = scopeSql('b', brandId, branchCategoryParams);
    const legacyBranchCategories = dataAccess.queryOne(`
      SELECT COUNT(*) AS count
      FROM branch_product_categories bpc
      JOIN branches b ON b.id = bpc.branch_id
      WHERE 1=1 ${branchCategoryScope}
    `, branchCategoryParams);

    const canonicalIntegrityParams = [];
    const canonicalIntegrityScope = scopeSql('p', brandId, canonicalIntegrityParams);
    const integrity = dataAccess.queryMany(`
      SELECT p.id AS product_id, p.brand_id
      FROM products p
      JOIN menu_items mi ON mi.product_id = p.id
      JOIN menus m ON m.id = mi.menu_id
      WHERE m.brand_id <> p.brand_id
        ${canonicalIntegrityScope}
      GROUP BY p.id, p.brand_id
      ORDER BY p.id ASC
    `, canonicalIntegrityParams);

    const productNeedsReviewCount = productStatus
      .filter(row => ['needs_review', 'failed'].includes(String(row.status)))
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const productLegacyCount = productStatus
      .filter(row => String(row.status) === 'legacy')
      .reduce((sum, row) => sum + Number(row.count || 0), 0);

    const productsWithoutCanonicalMenu = Number(productCoverage?.products_without_canonical_menu || 0);

    const promotionUnresolved = legacyPromotions.filter(
      row => Number(row.canonical_menu_candidates) !== 1
    ).length;
    const branchUnresolved = legacyBranches.length;
    const blockers = integrity.length;
    const legacyPromotionCount = legacyPromotions.length;
    const legacyBranchProductCount = Number(branchProductTotals?.total_legacy_branch_products || 0);
    const legacyBranchCategoryCount = Number(legacyBranchCategories?.count || 0);

    let status = STATUS.CANONICAL_READY;
    if (blockers > 0) {
      status = STATUS.BLOCKED;
    } else if (productsWithoutCanonicalMenu > 0 || productNeedsReviewCount > 0 || promotionUnresolved > 0 || branchUnresolved > 0) {
      status = STATUS.NEEDS_REVIEW;
    } else if (productLegacyCount > 0 || legacyPromotionCount > 0 || legacyBranchProductCount > 0 || legacyBranchCategoryCount > 0) {
      status = STATUS.LEGACY_REQUIRES_MIGRATION;
    }

    const result = {
      status,
      scope: { brand_id: brandId || null },
      products: {
        total: Number(productCoverage?.total_products || 0),
        with_canonical_menu: Number(productCoverage?.products_with_canonical_menu || 0),
        without_canonical_menu: Number(productCoverage?.products_without_canonical_menu || 0),
        canonical_menu_count: Number(productCoverage?.canonical_menu_count || 0),
        legacy_status_count: productLegacyCount,
        needs_review_status_count: productNeedsReviewCount,
        canonical_menu_gap_count: productsWithoutCanonicalMenu,
        migration_status: productStatus.map(row => ({
          status: row.status,
          schema_version: Number(row.schema_version),
          count: Number(row.count)
        }))
      },
      promotions: {
        legacy_product_target_count: legacyPromotionCount,
        unresolved_or_ambiguous_count: promotionUnresolved
      },
      branches: {
        legacy_branch_product_count: legacyBranchProductCount,
        unresolved_or_ambiguous_branch_product_count: branchUnresolved,
        legacy_branch_product_category_count: legacyBranchCategoryCount
      },
      integrity: {
        cross_brand_canonical_menu_product_count: blockers
      },
      retirement: {
        compatibility_data_present: Boolean(
          legacyPromotionCount || legacyBranchProductCount || legacyBranchCategoryCount
        ),
        safe_to_retire_legacy_data: status === STATUS.CANONICAL_READY
      }
    };

    if (includeRows) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
      result.unresolved = {
        promotions: legacyPromotions
          .filter(row => Number(row.canonical_menu_candidates) !== 1)
          .slice(0, safeLimit),
        branch_products: legacyBranches.slice(0, safeLimit),
        cross_brand_products: integrity.slice(0, safeLimit)
      };
    }

    return result;
  }
}

module.exports = {
  LegacyDataReadinessService,
  STATUS
};