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
      'SELECT id FROM branches WHERE id = ? AND brand_id = ? AND (is_archived = 0 OR is_archived IS NULL)',
      [branchId, brandId]
    ));
  }

  findRewardProduct(branchId, productId) {
    return this.db.queryOne(`
      SELECT bp.is_available, bp.stock, p.name, p.price, p.regular_price
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
      SELECT id, brand_id, branch_id, name, slug, image_url, sort_order, media_id
      FROM branch_categories
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `, [branchId, brandId]);
  }

  findBranchProducts({ branchId, brandId, activeOnly = true }) {
    const activeFilter = activeOnly ? 'AND (p.is_active = 1 OR p.is_active IS NULL)' : '';
    const products = this.db.queryMany(`
      SELECT
        bp.product_id as id,
        p.brand_id,
        COALESCE(bp.branch_category_id, p.category_id) as category_id,
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
        p.image_url as master_image_url,
        COALESCE(bp.image_media_id, p.media_id) as media_id
      FROM branch_products bp
      INNER JOIN products p ON bp.product_id = p.id AND p.brand_id = ? ${activeFilter}
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `, [brandId, branchId]);

    let catRows = [];
    try {
      catRows = this.db.queryMany(`
        SELECT bpc.product_id, bpc.branch_category_id, bc.name, bc.slug
        FROM branch_product_categories bpc
        JOIN branch_categories bc ON bc.id = bpc.branch_category_id
        WHERE bpc.branch_id = ?
        ORDER BY bc.sort_order ASC, bc.name ASC
      `, [branchId]);
    } catch (_) {}

    const catMap = {};
    for (const r of catRows) {
      if (!catMap[r.product_id]) catMap[r.product_id] = [];
      catMap[r.product_id].push({ id: r.branch_category_id, name: r.name, slug: r.slug });
    }

    return products.map(p => {
      const assignedCats = catMap[p.id] || [];
      const catIds = assignedCats.map(c => c.id);
      if (catIds.length === 0 && p.category_id) {
        catIds.push(p.category_id);
      }
      return {
        ...p,
        category_ids: catIds,
        categories: assignedCats
      };
    });
  }

  findProductCategories({ branchId, productId }) {
    return this.db.queryMany(`
      SELECT bc.id, bc.brand_id, bc.branch_id, bc.name, bc.slug, bc.image_url, bc.sort_order, bc.media_id
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `, [branchId, productId]);
  }

  findCategoryProducts({ branchId, branchCategoryId }) {
    return this.db.queryMany(`
      SELECT
        bp.product_id as id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.price,
        bp.stock,
        bp.is_available
      FROM branch_product_categories bpc
      JOIN branch_products bp ON bp.branch_id = bpc.branch_id AND bp.product_id = bpc.product_id
      JOIN products p ON p.id = bp.product_id
      WHERE bpc.branch_id = ? AND bpc.branch_category_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `, [branchId, branchCategoryId]);
  }

  assignProductCategory({ branchId, productId, branchCategoryId }) {
    return this.db.execute(`
      INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
      VALUES (?, ?, ?)
    `, [branchId, productId, branchCategoryId]);
  }

  removeProductCategory({ branchId, productId, branchCategoryId }) {
    return this.db.execute(`
      DELETE FROM branch_product_categories
      WHERE branch_id = ? AND product_id = ? AND branch_category_id = ?
    `, [branchId, productId, branchCategoryId]);
  }

  findBrandCategories(brandId, activeOnly = true) {
    const activeFilter = activeOnly ? 'AND (is_active = 1 OR is_active IS NULL)' : '';
    return this.db.queryMany(`
      SELECT id, brand_id, name, slug, image_url, image, sort_order, is_active, media_id
      FROM categories
      WHERE brand_id = ? ${activeFilter}
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
        1 as branch_availability,
        p.media_id
      FROM products p
      WHERE p.brand_id = ? AND p.is_active = 1
      ORDER BY p.sort_order ASC, p.name ASC
    `, [brandId]);
  }

}

module.exports = CatalogRepository;
