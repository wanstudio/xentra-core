/**
 * Xentra Commerce Catalog Service
 * Pure catalog display service for Customer PWA & menu presentation.
 *
 * BRANCH CATALOG MODEL (Master Product Default + Branch Optional Override):
 * When a branch context is provided, CatalogService queries branch_products as the
 * primary source (Branch Catalog), joining branch_categories for the category tree.
 * Resolution rule: branch override column is used when non-NULL; otherwise the live
 * Master Product value is used. This ensures master product updates propagate to all
 * branches that have not explicitly overridden the field.
 *
 * BRAND-WIDE MODEL (no branch context):
 * Queries the Master Catalog (products + categories) directly.
 *
 * Note: Does not perform final pre-payment stock locking (handled by PrePaymentVerificationGate).
 */
const db = require('../../../core/data/DataAccess');
const PricingPolicyModel = require('../models/PricingPolicyModel');

class CatalogService {
  static getMenu({ brand_id, branch_id = null }) {
    if (!brand_id) {
      throw new Error('[CatalogService] "brand_id" is required.');
    }

    if (branch_id) {
      return this._getBranchMenu(brand_id, branch_id);
    }
    return this._getBrandWideMenu(brand_id);
  }

  static _getBranchMenu(brand_id, branch_id) {
    const branchCategories = db.prepare(`
      SELECT * FROM branch_categories
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `).all(branch_id, brand_id);

    const rawProducts = db.prepare(`
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
    `).all(brand_id, branch_id);

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

      const isAvailable = prod.branch_availability === 1;

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
        is_active: prod.branch_availability === 1,
        is_available: isAvailable,
        stock_estimate: prod.branch_stock != null ? Number(prod.branch_stock) : 0,
        sort_order: prod.sort_order,
        name_override: prod.name_override || null,
        description_override: prod.description_override || null,
        image_override: prod.image_override || null,
        master_name: prod.master_name,
        master_description: prod.master_description,
        master_image_url: prod.master_image_url
      };
    });

    return {
      categories: branchCategories.map(c => ({
        id: c.id,
        brand_id: c.brand_id,
        name: c.name,
        slug: c.slug,
        image_url: c.image_url || null,
        sort_order: c.sort_order
      })),
      products: resolvedProducts
    };
  }

  static _getBrandWideMenu(brand_id) {
    const categories = db.prepare(`
      SELECT * FROM categories
      WHERE brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `).all(brand_id);

    const rawProducts = db.prepare(`
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
        is_available: true,
        stock_estimate: null,
        sort_order: prod.sort_order
      };
    });

    return {
      categories: categories.map(c => ({
        id: c.id,
        brand_id: c.brand_id,
        name: c.name,
        slug: c.slug,
        image_url: c.image_url || null,
        sort_order: c.sort_order
      })),
      products: resolvedProducts
    };
  }
}

module.exports = CatalogService;
