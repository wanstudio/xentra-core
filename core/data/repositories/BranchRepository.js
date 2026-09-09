'use strict';

/**
 * Branch persistence adapter.
 *
 * Exposes branch/delivery availability reads while keeping SQL/storage
 * details behind the data boundary. Branch matching and delivery decisions
 * remain owned by Core services.
 */
const DataAccess = require('../DataAccess');

class BranchRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findActiveDeliveryBranches(brandId) {
    return this.db.queryMany(`
      SELECT
        b.id, b.brand_id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
        b.is_active, b.is_open_override,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km,
        s.max_radius_km, s.min_order_amount, s.promo_delivery_discount, s.promo_min_order
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ?
        AND b.is_active = 1
        AND b.is_open_override = 1
        AND s.is_delivery_active = 1
    `, [brandId]);
  }
}

module.exports = BranchRepository;
