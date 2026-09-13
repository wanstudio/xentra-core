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

  findBranchDeliverySettings(branchId) {
    return this.db.queryOne(`
      SELECT
        b.id as branch_id,
        b.name as branch_name,
        b.is_active,
        b.is_open_override,
        s.id as settings_id,
        COALESCE(s.is_delivery_active, 1) as is_delivery_active,
        COALESCE(s.is_pickup_active, 1) as is_pickup_active,
        COALESCE(s.max_radius_km, 10.0) as max_radius_km,
        COALESCE(s.free_delivery_km, 3.0) as free_delivery_km,
        COALESCE(s.price_per_km, 2500.0) as price_per_km,
        COALESCE(s.min_order_amount, 0.0) as min_order_amount,
        COALESCE(s.promo_delivery_discount, 0.0) as promo_delivery_discount,
        COALESCE(s.promo_min_order, 0.0) as promo_min_order
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.id = ?
    `, [branchId]);
  }

  updateBranchDeliverySettings(branchId, {
    is_delivery_active,
    is_pickup_active,
    max_radius_km,
    free_delivery_km,
    price_per_km,
    min_order_amount,
    promo_delivery_discount,
    promo_min_order
  }) {
    const existing = this.db.queryOne('SELECT id FROM branch_delivery_settings WHERE branch_id = ?', [branchId]);
    const settingsId = existing ? existing.id : `bds_${Date.now()}`;
    const now = new Date().toISOString();

    return this.db.execute(`
      INSERT INTO branch_delivery_settings (
        id, branch_id, is_delivery_active, is_pickup_active, max_radius_km,
        free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        is_delivery_active = COALESCE(excluded.is_delivery_active, branch_delivery_settings.is_delivery_active),
        is_pickup_active = COALESCE(excluded.is_pickup_active, branch_delivery_settings.is_pickup_active),
        max_radius_km = COALESCE(excluded.max_radius_km, branch_delivery_settings.max_radius_km),
        free_delivery_km = COALESCE(excluded.free_delivery_km, branch_delivery_settings.free_delivery_km),
        price_per_km = COALESCE(excluded.price_per_km, branch_delivery_settings.price_per_km),
        min_order_amount = COALESCE(excluded.min_order_amount, branch_delivery_settings.min_order_amount),
        promo_delivery_discount = COALESCE(excluded.promo_delivery_discount, branch_delivery_settings.promo_delivery_discount),
        promo_min_order = COALESCE(excluded.promo_min_order, branch_delivery_settings.promo_min_order),
        updated_at = excluded.updated_at
    `, [
      settingsId, branchId,
      is_delivery_active !== undefined ? (is_delivery_active ? 1 : 0) : null,
      is_pickup_active !== undefined ? (is_pickup_active ? 1 : 0) : null,
      max_radius_km !== undefined ? Number(max_radius_km) : null,
      free_delivery_km !== undefined ? Number(free_delivery_km) : null,
      price_per_km !== undefined ? Number(price_per_km) : null,
      min_order_amount !== undefined ? Number(min_order_amount) : null,
      promo_delivery_discount !== undefined ? Number(promo_delivery_discount) : null,
      promo_min_order !== undefined ? Number(promo_min_order) : null,
      now, now
    ]);
  }
}

module.exports = BranchRepository;
