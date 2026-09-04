/**
 * Xentra Commerce Catalog Service
 * Pure catalog display service for Customer PWA & menu presentation.
 * Note: Does not perform final pre-payment stock locking (which is handled by PrePaymentVerificationGate).
 */
const db = require('../../../server/database/db');
const PricingPolicyModel = require('../models/PricingPolicyModel');

class CatalogService {
  /**
   * Retrieves active menu categories and products formatted for customer display.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} [params.branch_id]
   * @returns {{ categories: Array<Object>, products: Array<Object> }}
   */
  static getMenu({ brand_id, branch_id = null }) {
    if (!brand_id) {
      throw new Error('[CatalogService] "brand_id" is required.');
    }

    // 1. Fetch categories
    const categories = db.prepare(`
      SELECT * FROM categories 
      WHERE brand_id = ? 
      ORDER BY sort_order ASC, name ASC
    `).all(brand_id);

    // 2. Fetch raw product data with explicit branch override join
    let rawProducts = [];
    if (branch_id) {
      rawProducts = db.prepare(`
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
          bp.price as branch_raw_price,
          bp.stock as branch_stock,
          bp.is_available as branch_availability
        FROM products p
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = ?
        WHERE p.brand_id = ? AND p.is_active = 1
        ORDER BY p.sort_order ASC, p.name ASC
      `).all(branch_id, brand_id);
    } else {
      rawProducts = db.prepare(`
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
      `).all(brand_id);
    }

    // 3. Resolve pricing cleanly via PricingPolicyModel
    const resolvedProducts = rawProducts.map(prod => {
      const pricing = PricingPolicyModel.resolvePrice(
        {
          price: prod.owner_price,
          pricing_mode: prod.pricing_mode || 'lock',
          min_price: prod.min_price,
          max_price: prod.max_price
        },
        prod.branch_raw_price
      );

      // C1 CONSUMER COHERENCE: in a branch-scoped menu an item is operationally available ONLY
      // when it is explicitly assigned to that branch AND the branch availability flag is on
      // (bp row exists -> branch_availability 0|1; missing row -> NULL = unassigned = NOT available).
      // In a brand-wide (pre-branch) menu the master product list is presented as available.
      const isAvailable = prod.is_master_active === 1 && prod.branch_availability === 1;

      return {
        id: prod.id,
        brand_id: prod.brand_id,
        category_id: prod.category_id,
        name: prod.name,
        slug: prod.slug,
        description: prod.description,
        price: pricing.effective_price,
        regular_price: prod.owner_price,
        pricing_mode: pricing.mode,
        is_overridden: pricing.is_overridden,
        image_url: prod.image_url,
        is_active: prod.is_master_active === 1,
        is_available: isAvailable,
        // No artificial quantity: branch stock is only meaningful once a branch context exists;
        // unassigned/missing stock resolves to 0 (never a fake 999).
        stock_estimate: branch_id ? (prod.branch_stock != null ? Number(prod.branch_stock) : 0) : null,
        sort_order: prod.sort_order
      };
    });

    return {
      categories: categories.map(c => ({
        id: c.id,
        brand_id: c.brand_id,
        name: c.name,
        slug: c.slug,
        icon_url: c.icon_url,
        sort_order: c.sort_order
      })),
      products: resolvedProducts
    };
  }
}

module.exports = CatalogService;
