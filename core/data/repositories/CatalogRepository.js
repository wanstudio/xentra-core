'use strict';

/**
 * Catalog persistence adapter.
 *
 * This is the domain-oriented repository for catalog reads. SQL remains an
 * infrastructure concern here; callers consume semantic catalog operations.
 */
const DataAccess = require('../DataAccess');

class CatalogRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  branchBelongsToBrand(branchId, brandId) {
    return Boolean(this.db.queryOne(
      'SELECT id FROM branches WHERE id = ? AND brand_id = ?',
      [branchId, brandId]
    ));
  }

  findRewardProduct(branchId, productId) {
    return this.db.queryOne(`
      SELECT bp.is_available, p.name, p.price, p.regular_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `, [branchId, productId]);
  }

  findProductForBranch({ branchId, productId, brandId }) {
    return this.db.queryOne(`
      SELECT
        p.*,
        bp.branch_id as bp_branch_id,
        bp.price as branch_raw_price,
        bp.stock as branch_stock,
        bp.is_available as branch_availability,
        bp.low_stock_threshold as branch_low_stock_threshold
      FROM products p
      LEFT JOIN branch_products bp
        ON p.id = bp.product_id AND bp.branch_id = ?
      WHERE p.id = ? AND p.brand_id = ?
    `, [branchId, productId, brandId]);
  }

  findBranchCategories({ branchId, brandId }) {
    return this.db.queryMany(`
      SELECT * FROM branch_categories
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `, [branchId, brandId]);
  }

  findBranchProducts({ branchId, brandId }) {
    return this.db.queryMany(`
      SELECT
        bp.product_id as id,
        p.brand_id,
        bp.branch_category_id as category_id,
        COALESCE(bp.name_override, p.name) as name,
        p.slug,
        COALESCE(bp.description_override, p.description) as description,
        p.price as owner_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        COALESCE(bp.image_override, p.image_url) as image_url,
        p.sort_order,
        bp.price as branch_raw_price,
        bp.stock as branch_stock,
        bp.is_available as branch_availability,
        bp.name_override,
        bp.description_override,
        bp.image_override,
        p.name as master_name,
        p.description as master_description,
        p.image_url as master_image_url
      FROM branch_products bp
      INNER JOIN products p ON bp.product_id = p.id AND p.brand_id = ?
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `, [brandId, branchId]);
  }

  findBrandCategories(brandId) {
    return this.db.queryMany(`
      SELECT * FROM categories
      WHERE brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `, [brandId]);
  }

  findBrandActiveProducts(brandId) {
    return this.db.queryMany(`
      SELECT
        p.id,
        p.brand_id,
        p.category_id,
        p.name,
        p.slug,
        p.description,
        p.price as owner_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        p.image_url,
        p.is_active as is_master_active,
        p.sort_order,
        NULL as branch_raw_price,
        NULL as branch_stock,
        1 as branch_availability
      FROM products p
      WHERE p.brand_id = ? AND p.is_active = 1
      ORDER BY p.sort_order ASC, p.name ASC
    `, [brandId]);
  }
}

module.exports = CatalogRepository;
