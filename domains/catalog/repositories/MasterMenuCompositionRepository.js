'use strict';

const DataAccess = require('../../../core/data/DataAccess');

const DEFINITIONS = Object.freeze({
  flavor: {
    table: 'menu_flavors',
    idColumn: 'flavor_id'
  },
  complement: {
    table: 'menu_complements',
    idColumn: 'complement_id'
  },
  level: {
    table: 'menu_levels',
    idColumn: 'level_id'
  }
});

function definition(type) {
  const key = String(type || '').trim().toLowerCase();
  const def = DEFINITIONS[key];
  if (!def) throw new Error('INVALID_MENU_COMPONENT_TYPE');
  return { key, ...def };
}

function normalizeName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw new Error('MENU_COMPONENT_NAME_REQUIRED');
  if (name.length > 120) throw new Error('MENU_COMPONENT_NAME_TOO_LONG');
  return name;
}

function normalizeSlug(value, fallbackName) {
  const source = String(value == null ? '' : value).trim() || fallbackName;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!slug) throw new Error('MENU_COMPONENT_SLUG_REQUIRED');
  return slug;
}

class MasterMenuCompositionRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findComponent({ type, brandId, componentId }) {
    const def = definition(type);
    return this.db.queryOne(
      `SELECT id, brand_id, name, slug, sort_order, is_active, created_at, updated_at
       FROM ${def.table}
       WHERE id = ? AND brand_id = ?`,
      [componentId, brandId]
    );
  }

  listComponents({ type, brandId, activeOnly = false }) {
    const def = definition(type);
    const activeFilter = activeOnly ? 'AND (is_active = 1 OR is_active IS NULL)' : '';
    return this.db.queryMany(
      `SELECT id, brand_id, name, slug, sort_order, is_active, created_at, updated_at
       FROM ${def.table}
       WHERE brand_id = ? ${activeFilter}
       ORDER BY sort_order ASC, name ASC, id ASC`,
      [brandId]
    );
  }

  createComponent({ type, brandId, id, name, slug, sortOrder = null }) {
    const def = definition(type);
    const normalizedName = normalizeName(name);
    const normalizedSlug = normalizeSlug(slug, normalizedName);
    const order = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null;
    return this.db.execute(
      `INSERT INTO ${def.table} (id, brand_id, name, slug, sort_order, is_active)
       VALUES (?, ?, ?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ${def.table} WHERE brand_id = ?)), 1)`,
      [id, brandId, normalizedName, normalizedSlug, order, brandId]
    );
  }

  updateComponent({ type, brandId, componentId, name, slug, sortOrder, isActive }) {
    const def = definition(type);
    const current = this.findComponent({ type, brandId, componentId });
    if (!current) return null;

    const nextName = name === undefined ? current.name : normalizeName(name);
    const nextSlug = slug === undefined ? current.slug : normalizeSlug(slug, nextName);

    let normalizedActive = null;
    if (isActive !== undefined && isActive !== null) {
      normalizedActive = (isActive === true || isActive === 1 || isActive === '1' || isActive === 'true') ? 1
        : (isActive === false || isActive === 0 || isActive === '0' || isActive === 'false') ? 0
        : null;
    }

    this.db.execute(
      `UPDATE ${def.table}
       SET name = ?, slug = ?, sort_order = COALESCE(?, sort_order),
           is_active = COALESCE(?, is_active), updated_at = datetime('now')
       WHERE id = ? AND brand_id = ?`,
      [nextName, nextSlug, sortOrder !== undefined ? Number(sortOrder) : null, normalizedActive, componentId, brandId]
    );

    return this.findComponent({ type, brandId, componentId });
  }

  toggleComponent({ type, brandId, componentId }) {
    const def = definition(type);
    const stmt = this.db.execute(
      `UPDATE ${def.table}
       SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
           updated_at = datetime('now')
       WHERE id = ? AND brand_id = ?`,
      [componentId, brandId]
    );
    if (!stmt || stmt.changes === 0) return null;
    return this.findComponent({ type, brandId, componentId });
  }

  deleteComponent({ type, brandId, componentId }) {
    const def = definition(type);
    const existing = this.findComponent({ type, brandId, componentId });
    if (!existing) return { found: false, deleted: false };

    try {
      const stmt = this.db.execute(
        `DELETE FROM ${def.table} WHERE id = ? AND brand_id = ?`,
        [componentId, brandId]
      );
      return { found: true, deleted: !!(stmt && stmt.changes) };
    } catch (err) {
      if (/FOREIGN KEY|constraint/i.test(String(err && err.message))) {
        const e = new Error('MENU_COMPONENT_IN_USE');
        e.cause = err;
        throw e;
      }
      throw err;
    }
  }

  listMasterProducts({ brandId, activeOnly = true }) {
    if (!brandId) return [];
    const activeFilter = activeOnly ? 'AND p.is_active = 1' : '';
    return this.db.queryMany(
      `SELECT p.id, p.brand_id, p.category_id, p.name, p.slug, p.description,
              p.price, p.regular_price, p.pricing_mode, p.min_price, p.max_price,
              p.image_url, p.image, p.media_id, p.options_config, p.is_active, p.sort_order,
              c.name AS category_name, c.slug AS category_slug, c.is_active AS category_is_active
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.brand_id = p.brand_id
       WHERE p.brand_id = ? ${activeFilter}
       ORDER BY p.sort_order ASC, p.name ASC, p.id ASC`,
      [brandId]
    );
  }

  findMasterProducts({ brandId, productIds = [], activeOnly = true }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const activeFilter = activeOnly ? 'AND p.is_active = 1' : '';
    return this.db.queryMany(
      `SELECT p.id, p.brand_id, p.category_id, p.name, p.slug, p.description,
              p.price, p.regular_price, p.pricing_mode, p.min_price, p.max_price,
              p.image_url, p.image, p.media_id, p.options_config, p.is_active, p.sort_order,
              c.name AS category_name, c.slug AS category_slug, c.is_active AS category_is_active
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.brand_id = p.brand_id
       WHERE p.brand_id = ? AND p.id IN (${placeholders}) ${activeFilter}`,
      [brandId, ...ids]
    );
  }

  findProductFlavors({ brandId, productIds = [] }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.queryMany(
      `SELECT pf.product_id, mf.id, mf.name, mf.slug, mf.is_active
       FROM product_flavors pf
       JOIN menu_flavors mf ON mf.id = pf.flavor_id
       WHERE mf.brand_id = ? AND pf.product_id IN (${placeholders})`,
      [brandId, ...ids]
    );
  }

  findProductComplements({ brandId, productIds = [] }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.queryMany(
      `SELECT pc.product_id, mc.id, mc.name, mc.slug, mc.is_active, pc.sort_order
       FROM product_complements pc
       JOIN menu_complements mc ON mc.id = pc.complement_id
       WHERE mc.brand_id = ? AND pc.product_id IN (${placeholders})
       ORDER BY pc.product_id ASC, pc.sort_order ASC, mc.name ASC, mc.id ASC`,
      [brandId, ...ids]
    );
  }

  findProductLevels({ brandId, productIds = [] }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.queryMany(
      `SELECT pl.product_id, ml.id, ml.name, ml.slug, ml.is_active
       FROM product_levels pl
       JOIN menu_levels ml ON ml.id = pl.level_id
       WHERE ml.brand_id = ? AND pl.product_id IN (${placeholders})`,
      [brandId, ...ids]
    );
  }

  findBranchProductStates({ brandId, branchId, productIds = [] }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.queryMany(
      `SELECT bp.product_id, bp.branch_id, bp.is_available, bp.stock, bp.low_stock_threshold
       FROM branch_products bp
       JOIN branches b ON b.id = bp.branch_id AND b.brand_id = ?
       WHERE bp.branch_id = ? AND bp.product_id IN (${placeholders})`,
      [brandId, branchId, ...ids]
    );
  }

  findBranchProductCategoryMemberships({ branchId, productIds = [] }) {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.queryMany(
      `SELECT bpc.product_id, bpc.branch_category_id, bc.name, bc.slug, bc.sort_order,
              COALESCE(bc.is_active, 1) AS is_active
       FROM branch_product_categories bpc
       JOIN branch_categories bc
         ON bc.id = bpc.branch_category_id
        AND bc.branch_id = ?
       WHERE bpc.branch_id = ? AND bpc.product_id IN (${placeholders})
       ORDER BY bpc.product_id ASC, bc.sort_order ASC, bc.name ASC, bc.id ASC`,
      [branchId, branchId, ...ids]
    );
  }

  listBranchCategoriesForMenu({ branchId, brandId, activeOnly = false }) {
    const activeFilter = activeOnly ? 'AND (is_active = 1 OR is_active IS NULL)' : '';
    return this.db.queryMany(
      `SELECT id, brand_id, branch_id, name, slug, image_url, sort_order, media_id,
              COALESCE(is_active, 1) AS is_active
       FROM branch_categories
       WHERE branch_id = ? AND brand_id = ? ${activeFilter}
       ORDER BY sort_order ASC, name ASC, id ASC`,
      [branchId, brandId]
    );
  }

  findComposition({ brandId, productId }) {
    const product = this.db.queryOne(
      `SELECT p.id, p.brand_id, p.category_id,
              c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.brand_id = p.brand_id
       WHERE p.id = ? AND p.brand_id = ?`,
      [productId, brandId]
    );
    if (!product) return null;

    const flavor = this.db.queryOne(
      `SELECT mf.id, mf.name, mf.slug, mf.is_active
       FROM product_flavors pf
       JOIN menu_flavors mf ON mf.id = pf.flavor_id
       WHERE pf.product_id = ? AND mf.brand_id = ?`,
      [productId, brandId]
    );

    const complements = this.db.queryMany(
      `SELECT mc.id, mc.name, mc.slug, mc.is_active, pc.sort_order
       FROM product_complements pc
       JOIN menu_complements mc ON mc.id = pc.complement_id
       WHERE pc.product_id = ? AND mc.brand_id = ?
       ORDER BY pc.sort_order ASC, mc.name ASC, mc.id ASC`,
      [productId, brandId]
    );

    const level = this.db.queryOne(
      `SELECT ml.id, ml.name, ml.slug, ml.is_active
       FROM product_levels pl
       JOIN menu_levels ml ON ml.id = pl.level_id
       WHERE pl.product_id = ? AND ml.brand_id = ?`,
      [productId, brandId]
    );

    return {
      product_id: product.id,
      category: product.category_id ? { id: product.category_id, name: product.category_name, slug: product.category_slug } : null,
      flavor: flavor || null,
      complements,
      level: level || null
    };
  }

  replaceComposition({ brandId, productId, categoryId, flavorId = null, complementIds = [], levelId = null }) {
    const product = this.db.queryOne(
      'SELECT id, brand_id FROM products WHERE id = ? AND brand_id = ?',
      [productId, brandId]
    );
    if (!product) {
      throw new Error('MASTER_PRODUCT_NOT_FOUND');
    }

    const category = this.db.queryOne(
      'SELECT id FROM categories WHERE id = ? AND brand_id = ? AND (is_active = 1 OR is_active IS NULL)',
      [categoryId, brandId]
    );
    if (!category) {
      throw new Error('MASTER_CATEGORY_REQUIRED_OR_INVALID');
    }

    const normalizedFlavorId = flavorId == null || flavorId === '' ? null : String(flavorId);
    const normalizedLevelId = levelId == null || levelId === '' ? null : String(levelId);
    const normalizedComplementIds = Array.from(new Set(
      (Array.isArray(complementIds) ? complementIds : []).map(v => String(v || '').trim()).filter(Boolean)
    ));

    if (normalizedFlavorId) {
      const row = this.db.queryOne(
        'SELECT id, is_active FROM menu_flavors WHERE id = ? AND brand_id = ?',
        [normalizedFlavorId, brandId]
      );
      if (!row) throw new Error('MASTER_FLAVOR_INVALID');
      if (row.is_active === 0) throw new Error('MASTER_FLAVOR_INACTIVE');
    }

    for (const id of normalizedComplementIds) {
      const row = this.db.queryOne(
        'SELECT id, is_active FROM menu_complements WHERE id = ? AND brand_id = ?',
        [id, brandId]
      );
      if (!row) throw new Error('MASTER_COMPLEMENT_INVALID');
      if (row.is_active === 0) throw new Error('MASTER_COMPLEMENT_INACTIVE');
    }

    if (normalizedLevelId) {
      const row = this.db.queryOne(
        'SELECT id, is_active FROM menu_levels WHERE id = ? AND brand_id = ?',
        [normalizedLevelId, brandId]
      );
      if (!row) throw new Error('MASTER_LEVEL_INVALID');
      if (row.is_active === 0) throw new Error('MASTER_LEVEL_INACTIVE');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.execute(
        'UPDATE products SET category_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?',
        [categoryId, productId, brandId]
      );
      this.db.execute('DELETE FROM product_flavors WHERE product_id = ?', [productId]);
      this.db.execute('DELETE FROM product_complements WHERE product_id = ?', [productId]);
      this.db.execute('DELETE FROM product_levels WHERE product_id = ?', [productId]);

      if (normalizedFlavorId) {
        this.db.execute(
          'INSERT INTO product_flavors (product_id, flavor_id) VALUES (?, ?)',
          [productId, normalizedFlavorId]
        );
      }

      normalizedComplementIds.forEach((id, index) => {
        this.db.execute(
          'INSERT INTO product_complements (product_id, complement_id, sort_order) VALUES (?, ?, ?)',
          [productId, id, index]
        );
      });

      if (normalizedLevelId) {
        this.db.execute(
          'INSERT INTO product_levels (product_id, level_id) VALUES (?, ?)',
          [productId, normalizedLevelId]
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }

    return this.findComposition({ brandId, productId });
  }
}

module.exports = {
  MasterMenuCompositionRepository,
  definition,
  normalizeName,
  normalizeSlug
};
