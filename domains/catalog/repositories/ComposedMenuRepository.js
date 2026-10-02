'use strict';

const DataAccess = require('../../../core/data/DataAccess');
const { ensureComposedMenuSchema } = require('../schema/ComposedMenuSchema');

function ids(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(value => String(value == null ? '' : value).trim())
      .filter(Boolean)
  ));
}

function placeholders(count) {
  return new Array(count).fill('?').join(', ');
}

class ComposedMenuRepository {
  constructor(db = DataAccess) {
    this.db = db;
    ensureComposedMenuSchema(this.db);
  }

  findCategory({ brandId, categoryId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, name, slug, is_active FROM categories WHERE id = ? AND brand_id = ?",
      [categoryId, brandId]
    );
  }

  findSubCategory({ brandId, subCategoryId }) {
    return this.db.queryOne(
      "SELECT sc.id, sc.brand_id, sc.category_id, sc.name, sc.slug, sc.sort_order, sc.is_active, " +
      "c.name AS category_name, c.slug AS category_slug " +
      "FROM sub_categories sc " +
      "JOIN categories c ON c.id = sc.category_id AND c.brand_id = sc.brand_id " +
      "WHERE sc.id = ? AND sc.brand_id = ?",
      [subCategoryId, brandId]
    );
  }

  findSubCategoryByName({ brandId, name }) {
    return this.db.queryOne(
      "SELECT sc.id, sc.brand_id, sc.category_id, sc.name, sc.slug, sc.sort_order, sc.is_active, " +
      "c.name AS category_name, c.slug AS category_slug " +
      "FROM sub_categories sc " +
      "JOIN categories c ON c.id = sc.category_id AND c.brand_id = sc.brand_id " +
      "WHERE sc.brand_id = ? AND lower(trim(sc.name)) = lower(trim(?)) LIMIT 1",
      [brandId, name]
    );
  }

  listSubCategories({ brandId, categoryId = null, activeOnly = false }) {
    const categoryFilter = categoryId == null ? '' : ' AND sc.category_id = ?';
    const activeFilter = activeOnly ? ' AND sc.is_active = 1 AND c.is_active = 1' : '';
    const params = categoryId == null ? [brandId] : [brandId, categoryId];

    return this.db.queryMany(
      "SELECT sc.id, sc.brand_id, sc.category_id, sc.name, sc.slug, sc.sort_order, sc.is_active, " +
      "c.name AS category_name, c.slug AS category_slug " +
      "FROM sub_categories sc " +
      "JOIN categories c ON c.id = sc.category_id AND c.brand_id = sc.brand_id " +
      "WHERE sc.brand_id = ?" + categoryFilter + activeFilter +
      " ORDER BY sc.sort_order ASC, sc.name ASC, sc.id ASC",
      params
    );
  }

  createSubCategory({ id, brandId, categoryId, name, slug, sortOrder }) {
    return this.db.execute(
      "INSERT INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) " +
      "VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), 1)",
      [id, brandId, categoryId, name, slug, sortOrder]
    );
  }

  findRasa({ brandId, rasaId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_flavors WHERE id = ? AND brand_id = ?",
      [rasaId, brandId]
    );
  }

  findRasaByName({ brandId, name }) {
    return this.db.queryOne(
      "SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_flavors " +
      "WHERE brand_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1",
      [brandId, name]
    );
  }

  listRasas({ brandId, activeOnly = false }) {
    const activeFilter = activeOnly ? ' AND is_active = 1' : '';
    return this.db.queryMany(
      "SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_flavors " +
      "WHERE brand_id = ?" + activeFilter +
      " ORDER BY sort_order ASC, name ASC, id ASC",
      [brandId]
    );
  }

  createRasa({ id, brandId, name, slug, sortOrder = null }) {
    return this.db.execute(
      "INSERT INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) " +
      "VALUES (?, ?, ?, ?, COALESCE(?, 0), 1)",
      [id, brandId, name, slug, sortOrder]
    );
  }

  findLevel({ brandId, levelId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_levels WHERE id = ? AND brand_id = ?",
      [levelId, brandId]
    );
  }

  findProduct({ brandId, productId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, name, sku, description, image_url, image, is_active FROM products " +
      "WHERE id = ? AND brand_id = ?",
      [productId, brandId]
    );
  }

  updateProductSku({ brandId, productId, sku }) {
    return this.db.execute(
      "UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [sku, productId, brandId]
    );
  }

  findMenu({ brandId, menuId }) {
    return this.db.queryOne(
      "SELECT m.id, m.brand_id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, " +
      "m.package_name, m.selling_price, m.status, m.created_at, m.updated_at, " +
      "sc.name AS sub_category_name, sc.slug AS sub_category_slug, " +
      "c.id AS category_id, c.name AS category_name, c.slug AS category_slug, " +
      "r.name AS rasa_name, r.slug AS rasa_slug, " +
      "l.name AS level_name, l.slug AS level_slug, l.sort_order AS level_sort_order " +
      "FROM menus m " +
      "LEFT JOIN sub_categories sc ON sc.id = m.sub_category_id AND sc.brand_id = m.brand_id " +
      "LEFT JOIN categories c ON c.id = sc.category_id AND c.brand_id = m.brand_id " +
      "LEFT JOIN menu_flavors r ON r.id = m.rasa_id AND r.brand_id = m.brand_id " +
      "LEFT JOIN menu_levels l ON l.id = m.level_id AND l.brand_id = m.brand_id " +
      "WHERE m.id = ? AND m.brand_id = ?",
      [menuId, brandId]
    );
  }

  findSingleMenuByIdentity({ brandId, subCategoryId, rasaId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, menu_type, sub_category_id, rasa_id, level_id, package_name, selling_price, status " +
      "FROM menus WHERE brand_id = ? AND menu_type = 'SINGLE' AND sub_category_id = ? AND rasa_id = ? LIMIT 1",
      [brandId, subCategoryId, rasaId]
    );
  }

  createMenu({ id, brandId, menuType, subCategoryId = null, rasaId = null, levelId = null, packageName = null, sellingPrice, status }) {
    return this.db.execute(
      "INSERT INTO menus " +
      "(id, brand_id, menu_type, sub_category_id, rasa_id, level_id, package_name, selling_price, status) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, brandId, menuType, subCategoryId, rasaId, levelId, packageName, sellingPrice, status]
    );
  }

  replaceMenuItems({ menuId, items }) {
    this.db.execute('DELETE FROM menu_items WHERE menu_id = ?', [menuId]);
    items.forEach((item, index) => {
      this.db.execute(
        "INSERT INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, ?, ?)",
        [menuId, item.productId, item.quantity, index]
      );
    });
  }

  listMenuItems({ brandId, menuIds }) {
    const normalized = ids(menuIds);
    if (!normalized.length) return [];
    return this.db.queryMany(
      "SELECT mi.menu_id, mi.product_id, mi.quantity, mi.sort_order, " +
      "p.name AS product_name, p.sku, p.description AS product_description, " +
      "p.image_url AS product_image_url, p.image AS product_image, p.is_active AS product_is_active " +
      "FROM menu_items mi " +
      "JOIN menus m ON m.id = mi.menu_id AND m.brand_id = ? " +
      "JOIN products p ON p.id = mi.product_id AND p.brand_id = m.brand_id " +
      "WHERE mi.menu_id IN (" + placeholders(normalized.length) + ") " +
      "ORDER BY mi.menu_id ASC, mi.sort_order ASC, mi.product_id ASC",
      [brandId, ...normalized]
    );
  }

  listMenus({ brandId, menuType = null, status = null }) {
    const clauses = ['m.brand_id = ?'];
    const params = [brandId];
    if (menuType) {
      clauses.push('m.menu_type = ?');
      params.push(menuType);
    }
    if (status) {
      clauses.push('m.status = ?');
      params.push(status);
    }

    return this.db.queryMany(
      "SELECT m.id, m.brand_id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, " +
      "m.package_name, m.selling_price, m.status, " +
      "sc.name AS sub_category_name, sc.slug AS sub_category_slug, " +
      "c.id AS category_id, c.name AS category_name, c.slug AS category_slug, " +
      "r.name AS rasa_name, r.slug AS rasa_slug, " +
      "l.name AS level_name, l.slug AS level_slug, l.sort_order AS level_sort_order " +
      "FROM menus m " +
      "LEFT JOIN sub_categories sc ON sc.id = m.sub_category_id AND sc.brand_id = m.brand_id " +
      "LEFT JOIN categories c ON c.id = sc.category_id AND c.brand_id = m.brand_id " +
      "LEFT JOIN menu_flavors r ON r.id = m.rasa_id AND r.brand_id = m.brand_id " +
      "LEFT JOIN menu_levels l ON l.id = m.level_id AND l.brand_id = m.brand_id " +
      "WHERE " + clauses.join(' AND ') +
      " ORDER BY COALESCE(sc.sort_order, 999999) ASC, sc.name ASC, m.package_name ASC, m.id ASC",
      params
    );
  }

  findBranchMenu({ brandId, branchId, menuId }) {
    return this.db.queryOne(
      "SELECT bm.branch_id, bm.menu_id, bm.is_available, bm.price_override, " +
      "m.brand_id, m.menu_type, m.selling_price, m.status " +
      "FROM branch_menus bm " +
      "JOIN menus m ON m.id = bm.menu_id AND m.brand_id = ? " +
      "JOIN branches b ON b.id = bm.branch_id AND b.brand_id = ? " +
      "WHERE bm.branch_id = ? AND bm.menu_id = ?",
      [brandId, brandId, branchId, menuId]
    );
  }

  upsertBranchMenu({ brandId, branchId, menuId, isAvailable = 1, priceOverride = null }) {
    const menu = this.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');
    const branch = this.db.queryOne(
      "SELECT id FROM branches WHERE id = ? AND brand_id = ?",
      [branchId, brandId]
    );
    if (!branch) throw new Error('BRANCH_NOT_FOUND');

    const existing = this.findBranchMenu({ brandId, branchId, menuId });
    if (existing) {
      return this.db.execute(
        "UPDATE branch_menus SET is_available = ?, price_override = ?, updated_at = datetime('now') " +
        "WHERE branch_id = ? AND menu_id = ?",
        [isAvailable ? 1 : 0, priceOverride, branchId, menuId]
      );
    }

    return this.db.execute(
      "INSERT INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, ?, ?)",
      [branchId, menuId, isAvailable ? 1 : 0, priceOverride]
    );
  }

  listBranchMenuCategoryMemberships({ brandId, branchId, menuId = null }) {
    const clauses = ['bmc.branch_id = ?', 'm.brand_id = ?'];
    const params = [branchId, brandId];
    if (menuId != null) {
      clauses.push('bmc.menu_id = ?');
      params.push(menuId);
    }

    return this.db.queryMany(
      "SELECT bmc.branch_id, bmc.menu_id, bmc.branch_category_id, " +
      "bc.name AS branch_category_name, bc.slug AS branch_category_slug, " +
      "bc.is_active AS branch_category_is_active " +
      "FROM branch_menu_categories bmc " +
      "JOIN menus m ON m.id = bmc.menu_id AND m.brand_id = ? " +
      "JOIN branch_categories bc ON bc.id = bmc.branch_category_id AND bc.branch_id = bmc.branch_id " +
      "WHERE " + clauses.join(' AND ') +
      " ORDER BY bc.sort_order ASC, bc.name ASC, bmc.menu_id ASC",
      [brandId, ...params]
    );
  }

  replaceBranchMenuCategories({ brandId, branchId, menuId, branchCategoryIds }) {
    const normalized = ids(branchCategoryIds);
    this.db.execute(
      'DELETE FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ?',
      [branchId, menuId]
    );

    normalized.forEach(categoryId => {
      const category = this.db.queryOne(
        "SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?",
        [categoryId, branchId, brandId]
      );
      if (!category) throw new Error('BRANCH_CATEGORY_NOT_FOUND');
      this.db.execute(
        "INSERT INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, ?)",
        [branchId, menuId, categoryId]
      );
    });
  }

  getInventory({ branchId, productIds }) {
    const normalized = ids(productIds);
    if (!normalized.length) return [];
    return this.db.queryMany(
      "SELECT bpi.branch_id, bpi.product_id, bpi.stock_qty, bpi.low_stock_threshold, p.sku " +
      "FROM branch_product_inventory bpi JOIN products p ON p.id = bpi.product_id " +
      "WHERE bpi.branch_id = ? AND bpi.product_id IN (" + placeholders(normalized.length) + ")",
      [branchId, ...normalized]
    );
  }

  ensureInventoryRow({ branchId, productId, lowStockThreshold = 5 }) {
    return this.db.execute(
      "INSERT OR IGNORE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) " +
      "VALUES (?, ?, 0, ?)",
      [branchId, productId, lowStockThreshold]
    );
  }

  begin() {
    this.db.exec('BEGIN IMMEDIATE');
  }

  commit() {
    this.db.exec('COMMIT');
  }

  rollback() {
    this.db.exec('ROLLBACK');
  }
}

module.exports = ComposedMenuRepository;
