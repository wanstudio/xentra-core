/**
 * Xentra Promo Domain — Promotion Engine Service
 * Authoritative orchestrator for evaluating, listing, creating, and updating promotions.
 */
const db = require('../../../server/database/db');
const PromotionModel = require('../models/PromotionModel');
const InstallIncentiveStrategy = require('../strategies/InstallIncentiveStrategy');

class PromotionEngineService {
  static _strategies = new Map();

  static {
    // Register standard strategies
    this.registerStrategy(new InstallIncentiveStrategy());
  }

  static registerStrategy(strategy) {
    if (strategy && strategy.type) {
      this._strategies.set(strategy.type, strategy);
    }
  }

  /**
   * Retrieves all active promotions for a brand and optional branch.
   * @param {string} brandId
   * @param {string} [branchId]
   * @returns {Array<Object>}
   */
  static getActivePromotions(brandId, branchId = null) {
    if (!brandId) return [];

    let query = `
      SELECT * FROM promotions 
      WHERE brand_id = ? 
        AND is_active = 1 
        AND (branch_id IS NULL OR branch_id = ?)
      ORDER BY created_at DESC
    `;

    return db.prepare(query).all(brandId, branchId || '');
  }

  /**
   * Evaluates active promotions against a client checkout context.
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} [params.branch_id]
   * @param {boolean} [params.is_pwa_installed]
   * @param {string} [params.customer_phone]
   * @param {Array<Object>} [params.cart_items]
   * @param {number} [params.cart_subtotal]
   * @returns {Array<Object>} Evaluated promotion results
   */
  static evaluatePromotions({
    brand_id,
    branch_id = null,
    is_pwa_installed = false,
    customer_phone = '',
    cart_items = [],
    cart_subtotal = 0
  }) {
    const activePromos = this.getActivePromotions(brand_id, branch_id);
    if (!activePromos.length) return [];

    // Calculate customer prior orders count if phone is provided
    let priorOrdersCount = 0;
    if (customer_phone) {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM orders 
        WHERE customer_phone = ? AND brand_id = ? AND status != 'cancelled'
      `).get(customer_phone, brand_id);
      if (row) priorOrdersCount = Number(row.count || 0);
    }

    const context = {
      is_pwa_installed: Boolean(is_pwa_installed),
      customer_phone,
      prior_orders_count: priorOrdersCount,
      cart_items,
      cart_subtotal
    };

    const results = [];
    for (const promo of activePromos) {
      const strategy = this._strategies.get(promo.promo_type);
      if (!strategy) continue;

      const evalResult = strategy.evaluate(promo, context);
      if (evalResult.isApplicable) {
        results.push({
          promo_id: promo.id,
          promo_type: promo.promo_type,
          name: promo.name,
          ...evalResult
        });
      }
    }

    return results;
  }

  /**
   * Creates or updates a promotion rule (Admin/Merchant Dashboard).
   * @param {Object} promoData
   * @returns {Object} Created or updated promotion
   */
  static savePromotion(promoData) {
    const validation = PromotionModel.validate(promoData);
    if (!validation.isValid) {
      throw new Error(`[PromotionEngineService] Validation error: ${validation.errors.join('; ')}`);
    }

    const id = promoData.id || `promo_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM promotions WHERE id = ?').get(id);

    if (existing) {
      db.prepare(`
        UPDATE promotions SET
          branch_id = ?,
          code = ?,
          promo_type = ?,
          name = ?,
          banner_title = ?,
          banner_subtitle = ?,
          reward_title = ?,
          reward_badge_text = ?,
          icon_url = ?,
          reward_type = ?,
          target_product_id = ?,
          reward_price = ?,
          min_spend = ?,
          target_audience = ?,
          requires_pwa_installed = ?,
          max_claims_per_user = ?,
          total_quota = ?,
          start_at = ?,
          end_at = ?,
          is_active = ?,
          updated_at = ?
        WHERE id = ? AND brand_id = ?
      `).run(
        promoData.branch_id || null,
        promoData.code || null,
        promoData.promo_type,
        promoData.name,
        promoData.banner_title || null,
        promoData.banner_subtitle || null,
        promoData.reward_title || null,
        promoData.reward_badge_text || null,
        promoData.icon_url || null,
        promoData.reward_type || 'freebie_product',
        promoData.target_product_id || null,
        promoData.reward_price !== undefined ? Number(promoData.reward_price) : 0,
        promoData.min_spend !== undefined ? Number(promoData.min_spend) : 0,
        promoData.target_audience || 'new_user',
        promoData.requires_pwa_installed !== undefined ? Number(promoData.requires_pwa_installed) : 1,
        promoData.max_claims_per_user !== undefined ? Number(promoData.max_claims_per_user) : 1,
        promoData.total_quota !== undefined ? Number(promoData.total_quota) : null,
        promoData.start_at || null,
        promoData.end_at || null,
        promoData.is_active !== undefined ? Number(promoData.is_active) : 1,
        now,
        id,
        promoData.brand_id
      );
    } else {
      db.prepare(`
        INSERT INTO promotions (
          id, brand_id, branch_id, code, promo_type, name,
          banner_title, banner_subtitle, reward_title, reward_badge_text, icon_url,
          reward_type, target_product_id, reward_price, min_spend,
          target_audience, requires_pwa_installed, max_claims_per_user, total_quota,
          start_at, end_at, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        promoData.brand_id,
        promoData.branch_id || null,
        promoData.code || null,
        promoData.promo_type,
        promoData.name,
        promoData.banner_title || null,
        promoData.banner_subtitle || null,
        promoData.reward_title || null,
        promoData.reward_badge_text || null,
        promoData.icon_url || null,
        promoData.reward_type || 'freebie_product',
        promoData.target_product_id || null,
        promoData.reward_price !== undefined ? Number(promoData.reward_price) : 0,
        promoData.min_spend !== undefined ? Number(promoData.min_spend) : 0,
        promoData.target_audience || 'new_user',
        promoData.requires_pwa_installed !== undefined ? Number(promoData.requires_pwa_installed) : 1,
        promoData.max_claims_per_user !== undefined ? Number(promoData.max_claims_per_user) : 1,
        promoData.total_quota !== undefined ? Number(promoData.total_quota) : null,
        promoData.start_at || null,
        promoData.end_at || null,
        promoData.is_active !== undefined ? Number(promoData.is_active) : 1,
        now,
        now
      );
    }

    return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
  }
}

module.exports = PromotionEngineService;
