/**
 * Xentra Commerce Catalog Service
 * Pure catalog display service for Customer PWA & menu presentation.
 *
 * BRANCH CATALOG MODEL:
 * When a branch context is provided, CatalogService queries branch_products as the
 * primary source (Branch Catalog), joining branch_categories for the category tree.
 * This implements the LOCKED save-point semantics: Branch Catalog is NOT a filtered
 * view of Master Catalog. Each Branch owns its category structure and product placement.
 *
 * BRAND-WIDE MODEL (no branch context):
 * Queries the Master Catalog (products + categories) directly.
 *
 * Note: Does not perform final pre-payment stock locking (handled by PrePaymentVerificationGate).
 */
const db = require('../../../server/database/db');
const PricingPolicyModel = require('../models/PricingPolicyModel');

class CatalogService {
  /**
   * Retrieves active menu categories and products formatted for customer display.
   *
   * BRANCH CONTEXT (branch_id provided):
   *   Source = branch_products + branch_categories (Branch Catalog).
   *   Only adopted products appear. Categories are Branch-owned.
   *   Product metadata uses snapshot fields (product_name, etc.) with master fallback.
   *
   * BRAND-WIDE (no branch_id):
   *   Source = products + categories (Master Catalog).
   *   All active master products are shown.
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

    if (branch_id) {
      return this._getBranchMenu(brand_id, branch_id);
    }
    return this._getBrandWideMenu(brand_id);
  }

  /**
   * BRANCH CATALOG: branch_products is the source of truth.
   * Only adopted products appear. Categories come from branch_categories.
   */
  static _getBranchMenu(brand_id, branch_id) {
    // 1. Fetch branch-owned categories
    const branchCategories = db.prepare(`
      SELECT * FROM branch_categories
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `).all(branch_id, brand_id);

    // 2. Fetch adopted products (branch_products is the source) with master fallback for pricing
    const rawProducts = db.prepare(`
      SELECT
        bp.product_id as id,
        p.brand_id,
        bp.branch_category_id as category_id,
        COALESCE(bp.product_name, p.name) as name,
        p.slug,
        COALESCE(bp.product_description, p.description) as description,
        p.price as owner_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        COALESCE(bp.product_image_url, p.image_url) as image_url,
        p.sort_order,
        bp.price as branch_raw_price,
        bp.stock as branch_stock,
        bp.is_available as branch_availability
      FROM branch_products bp
      INNER JOIN products p ON bp.product_id = p.id AND p.brand_id = ?
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(brand_id, branch_id);

    // 3. Resolve pricing and build response
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

      // BRANCH CATALOG OWNERSHIP: once adopted, branch_products controls availability.
      // Master Product is_active does NOT gate Branch Catalog availability.
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
        sort_order: prod.sort_order
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

  /**
   * BRAND-WIDE CATALOG: Master Catalog is the source.
   * All active master products are shown. Categories come from master categories.
   */
  static _getBrandWideMenu(brand_id) {
    // 1. Fetch master categories
    const categories = db.prepare(`
      SELECT * FROM categories
      WHERE brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `).all(brand_id);

    // 2. Fetch all active master products
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

    // 3. Resolve pricing and build response
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
