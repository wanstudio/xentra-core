'use strict';

/**
 * Eligibility persistence adapter.
 *
 * Exposes authoritative operational facts needed by EligibilityService while
 * keeping SQL/storage details behind the data boundary.
 */
const DataAccess = require('../DataAccess');

class EligibilityRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findBranchEligibilityContext({ branchId, brandId }) {
    return this.db.queryOne(`
      SELECT b.id, b.brand_id, b.name, b.is_active, b.is_open_override,
             s.is_delivery_active, s.is_pickup_active
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.id = ? AND b.brand_id = ?
    `, [branchId, brandId]);
  }

  findProductForEligibility({ productId, brandId }) {
    return this.db.queryOne(
      'SELECT id, name, is_active FROM products WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );
  }

  findBranchProductEligibility({ branchId, productId }) {
    return this.db.queryOne(
      'SELECT stock, is_available FROM branch_products WHERE branch_id = ? AND product_id = ?',
      [branchId, productId]
    );
  }
}

module.exports = EligibilityRepository;
