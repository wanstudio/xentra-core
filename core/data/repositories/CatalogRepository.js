'use strict';

/**
 * Catalog persistence adapter.
 *
 * This is the first domain-oriented repository extracted from the transitional
 * DataAccess seam. SQL remains an infrastructure concern here; callers should
 * consume semantic catalog operations rather than raw queries.
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
}

module.exports = CatalogRepository;
