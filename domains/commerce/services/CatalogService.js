/**
 * Xentra Commerce Catalog Service
 * Manages product menu queries, category aggregation, and branch-specific price calculation.
 */
const db = require('../../../server/database/db');
const PricingPolicyModel = require('../models/PricingPolicyModel');

class CatalogService {
  /**
   * Retrieves active menu categories and products for a given branch and brand.
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

    // 2. Fetch products
    let products = [];
    if (branch_id) {
      // Products mapped to specific branch with branch pricing/stock overrides
      products = db.prepare(`
        SELECT 
          p.*,
          COALESCE(bp.price, p.price) as effective_price,
          COALESCE(bp.stock, 0) as branch_stock,
          COALESCE(bp.is_available, 1) as is_available_at_branch
        FROM products p
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = ?
        WHERE p.brand_id = ? AND p.is_active = 1
        ORDER BY p.sort_order ASC, p.name ASC
      `).all(branch_id, brand_id);
    } else {
      // General brand catalog
      products = db.prepare(`
        SELECT p.*, p.price as effective_price, 999 as branch_stock, 1 as is_available_at_branch
        FROM products p
        WHERE p.brand_id = ? AND p.is_active = 1
        ORDER BY p.sort_order ASC, p.name ASC
      `).all(brand_id);
    }

    // Apply Pricing Policy resolution
    const resolvedProducts = products.map(prod => {
      const pricing = PricingPolicyModel.resolvePrice(
        {
          price: prod.price,
          pricing_mode: prod.pricing_mode || 'lock',
          min_price: prod.min_price,
          max_price: prod.max_price
        },
        prod.effective_price !== prod.price ? { price: prod.effective_price } : null
      );

      return {
        id: prod.id,
        brand_id: prod.brand_id,
        category_id: prod.category_id,
        name: prod.name,
        slug: prod.slug,
        description: prod.description,
        price: pricing.effective_price,
        base_price: prod.price,
        pricing_mode: pricing.mode,
        is_overridden: pricing.is_overridden,
        image_url: prod.image_url,
        is_active: prod.is_active === 1,
        is_available: prod.is_available_at_branch === 1,
        stock: prod.branch_stock,
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
