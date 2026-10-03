'use strict';

const crypto = require('crypto');
const DataAccess = require('../../../core/data/DataAccess');
const { ensureComposedMenuSchema } = require('../schema/ComposedMenuSchema');
const ComposedMenuMigrationRepository = require('../migrations/ComposedMenuMigrationRepository').ComposedMenuMigrationRepository;

const migrationRepository = new ComposedMenuMigrationRepository();

const STATUS = Object.freeze({
  LEGACY: 'legacy',
  NEEDS_REVIEW: 'needs_review',
  MIGRATED: 'migrated',
  VERIFIED: 'verified',
  FAILED: 'failed'
});

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generatedSku(brandId, productId) {
  return 'XPRD-' + sha256(String(brandId) + ':' + String(productId)).slice(0, 12).toUpperCase();
}

function uniqueSorted(values) {
  return Array.from(new Set((values || []).map(v => String(v)).filter(Boolean))).sort();
}

function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row || {}, key);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function legacyRowsForProduct(productId) {
  const branchProducts = DataAccess.queryMany(
    "SELECT branch_id, product_id, branch_category_id, product_name, product_description, product_image_url, " +
    "name_override, description_override, image_override, price, stock, is_available, low_stock_threshold " +
    "FROM branch_products WHERE product_id = ? ORDER BY branch_id ASC",
    [productId]
  );

  const branchMemberships = DataAccess.queryMany(
    "SELECT bpc.branch_id, bpc.product_id, bpc.branch_category_id " +
    "FROM branch_product_categories bpc " +
    "JOIN branch_categories bc ON bc.id = bpc.branch_category_id AND bc.branch_id = bpc.branch_id " +
    "WHERE bpc.product_id = ? ORDER BY bpc.branch_id ASC, bpc.branch_category_id ASC",
    [productId]
  );

  const flavors = DataAccess.queryMany(
    "SELECT pf.flavor_id, mf.name, mf.slug, mf.is_active " +
    "FROM product_flavors pf LEFT JOIN menu_flavors mf ON mf.id = pf.flavor_id " +
    "WHERE pf.product_id = ? ORDER BY pf.flavor_id ASC",
    [productId]
  );

  const complements = DataAccess.queryMany(
    "SELECT pc.complement_id, mc.name, mc.slug, mc.is_active, pc.sort_order " +
    "FROM product_complements pc LEFT JOIN menu_complements mc ON mc.id = pc.complement_id " +
    "WHERE pc.product_id = ? ORDER BY pc.sort_order ASC, pc.complement_id ASC",
    [productId]
  );

  const levels = DataAccess.queryMany(
    "SELECT pl.level_id, ml.name, ml.slug, ml.is_active, ml.sort_order " +
    "FROM product_levels pl LEFT JOIN menu_levels ml ON ml.id = pl.level_id " +
    "WHERE pl.product_id = ? ORDER BY pl.level_id ASC",
    [productId]
  );

  const movementCount = DataAccess.queryOne(
    "SELECT COUNT(*) AS count FROM inventory_movements WHERE product_id = ?",
    [productId]
  );

  return {
    branchProducts,
    branchMemberships,
    flavors,
    complements,
    levels,
    historicalMovementCount: Number(movementCount && movementCount.count || 0)
  };
}

function inspectProduct({ brandId, productId }) {
  ensureComposedMenuSchema(DataAccess);

  if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
  if (!productId) throw new Error('MASTER_PRODUCT_REQUIRED');

  const product = DataAccess.queryOne(
    "SELECT id, brand_id, category_id, name, slug, description, image_url, image, price, regular_price, " +
    "is_active, sku FROM products WHERE id = ? AND brand_id = ?",
    [productId, brandId]
  );

  if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');

  const category = product.category_id
    ? DataAccess.queryOne(
      "SELECT id, brand_id, name, slug, is_active FROM categories WHERE id = ? AND brand_id = ?",
      [product.category_id, brandId]
    )
    : null;

  return {
    product,
    category,
    legacy: legacyRowsForProduct(productId),
    existingMenu: null,
    migration: migrationRepository.find({ brandId, productId })
  };
}

function planIdentity(inspected) {
  const issues = [];
  const warnings = [];
  const { product, category, legacy } = inspected;

  if (!category) {
    issues.push('MASTER_CATEGORY_REQUIRED');
  } else if (category.is_active === 0) {
    issues.push('MASTER_CATEGORY_INACTIVE');
  }

  if (!normalizeText(product.name)) issues.push('PRODUCT_NAME_REQUIRED');
  if (numberOrNull(product.price) === null || Number(product.price) < 0) issues.push('LEGACY_PRICE_INVALID');

  if (legacy.flavors.length > 1) {
    issues.push('AMBIGUOUS_LEGACY_RASA');
  }

  let rasa = null;
  if (legacy.flavors.length === 1) {
    const row = legacy.flavors[0];
    if (!row.name || row.is_active === null || row.is_active === 0) {
      issues.push('LEGACY_RASA_INVALID_OR_INACTIVE');
    } else {
      rasa = { id: String(row.flavor_id), name: row.name };
    }
  } else if (legacy.flavors.length === 0) {
    const original = DataAccess.queryOne(
      "SELECT id, name, is_active FROM menu_flavors WHERE brand_id = ? AND lower(trim(name)) = 'original' LIMIT 1",
      [product.brand_id]
    );
    if (original && original.is_active !== 0) {
      rasa = { id: String(original.id), name: original.name };
    } else if (!original) {
      rasa = { id: null, name: 'Original', create: true };
    } else {
      issues.push('ORIGINAL_RASA_INACTIVE');
    }
  }

  let level = null;
  if (legacy.levels.length > 1) {
    issues.push('AMBIGUOUS_LEGACY_LEVEL');
  } else if (legacy.levels.length === 1) {
    const row = legacy.levels[0];
    if (!row.name || row.is_active === null || row.is_active === 0) {
      issues.push('LEGACY_LEVEL_INVALID_OR_INACTIVE');
    } else {
      level = { id: String(row.level_id), name: row.name, sort_order: row.sort_order };
    }
  }

  // Legacy complements/add-ons are deliberately NOT converted to Menu Paket.
  // Their Product identity mapping is not deterministic here, so migration pauses.
  if (legacy.complements.length > 0) {
    issues.push('LEGACY_COMPLEMENTS_REQUIRE_OWNER_REVIEW');
  }

  const normalizedProductName = normalizeKey(product.name);
  let subCategory = null;
  if (category) {
    subCategory = DataAccess.queryOne(
      "SELECT id, brand_id, category_id, name, slug, is_active FROM sub_categories " +
      "WHERE brand_id = ? AND lower(trim(name)) = ? LIMIT 1",
      [brandId, normalizedProductName]
    );
    if (subCategory && String(subCategory.category_id) !== String(category.id)) {
      issues.push('SUB_CATEGORY_PARENT_CONFLICT');
    } else if (subCategory && subCategory.is_active === 0) {
      issues.push('SUB_CATEGORY_INACTIVE');
    } else if (!subCategory) {
      const candidateSlug = normalizeKey(product.name)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
      if (candidateSlug) {
        const slugConflict = DataAccess.queryOne(
          "SELECT id, name FROM sub_categories WHERE brand_id = ? AND slug = ? LIMIT 1",
          [brandId, candidateSlug]
        );
        if (slugConflict && normalizeKey(slugConflict.name) !== normalizedProductName) {
          issues.push('SUB_CATEGORY_SLUG_CONFLICT');
        }
      }
    }
  }

  const targetSku = normalizeText(product.sku) || null;
  const hasPositiveLegacyStock = legacy.branchProducts.some(row => {
    const stock = numberOrNull(row.stock);
    return stock !== null && stock > 0;
  });
  const needsSku = Boolean(targetSku) || hasPositiveLegacyStock || legacy.historicalMovementCount > 0;

  let sku = targetSku;
  if (needsSku && !sku) {
    sku = generatedSku(brandId, productIdFrom(inspected));
    const collision = DataAccess.queryOne(
      "SELECT id FROM products WHERE brand_id = ? AND lower(trim(sku)) = lower(trim(?)) AND id <> ? LIMIT 1",
      [brandId, sku, inspected.product.id]
    );
    if (collision) issues.push('GENERATED_SKU_COLLISION');
    warnings.push('SKU_GENERATED_DETERMINISTICALLY');
  }

  for (const row of legacy.branchProducts) {
    const stock = numberOrNull(row.stock);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      issues.push('LEGACY_STOCK_NOT_NON_NEGATIVE_INTEGER');
    }

    if (row.is_available !== null && row.is_available !== undefined) {
      const available = Number(row.is_available);
      if (available !== 0 && available !== 1) issues.push('LEGACY_BRANCH_AVAILABILITY_INVALID');
    }

    const branchPrice = numberOrNull(row.price);
    if (branchPrice !== null && branchPrice < 0) {
      issues.push('LEGACY_BRANCH_PRICE_INVALID');
    }

    const threshold = numberOrNull(row.low_stock_threshold);
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) {
      issues.push('LEGACY_LOW_STOCK_THRESHOLD_INVALID');
    }

    const branch = DataAccess.queryOne(
      "SELECT id, brand_id FROM branches WHERE id = ? AND brand_id = ?",
      [row.branch_id, brandId]
    );
    if (!branch) issues.push('BRANCH_NOT_FOUND');
  }

  const membershipBranchIds = new Set(legacy.branchMemberships.map(row => String(row.branch_id)));
  const sourceBranchIds = new Set(legacy.branchProducts.map(row => String(row.branch_id)));
  for (const branchId of membershipBranchIds) {
    if (!sourceBranchIds.has(branchId)) {
      issues.push('ORPHAN_BRANCH_CATEGORY_MEMBERSHIP');
      break;
    }
  }

  if (legacy.historicalMovementCount > 0 && legacy.branchProducts.length === 0) {
    issues.push('HISTORICAL_INVENTORY_WITHOUT_BRANCH_STOCK_SOURCE');
  }

  return {
    issues: uniqueSorted(issues),
    warnings: uniqueSorted(warnings),
    subCategory: subCategory ? {
      id: String(subCategory.id),
      category_id: String(subCategory.category_id),
      name: subCategory.name
    } : {
      id: null,
      category_id: category ? String(category.id) : null,
      name: product.name,
      create: Boolean(category)
    },
    rasa,
    level,
    sku,
    needsSku
  };
}

function productIdFrom(inspected) {
  return inspected.product.id;
}

function buildPlan({ brandId, productId }) {
  const inspected = inspectProduct({ brandId, productId });
  const identity = planIdentity(inspected);
  // Product reuse is explicitly allowed by the contract. Only the exact
  // canonical Menu Satuan identity (Sub Category + Rasa) is relevant here;
  // another Menu backed by the same Product is not a migration conflict.
  const identityMenu = identity.rasa && identity.rasa.id
    ? DataAccess.queryOne(
      "SELECT m.id, m.brand_id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, m.selling_price, m.status, " +
      "mi.product_id, mi.quantity " +
      "FROM menus m LEFT JOIN menu_items mi ON mi.menu_id = m.id " +
      "WHERE m.brand_id = ? AND m.menu_type = 'SINGLE' AND m.sub_category_id = ? AND m.rasa_id = ? LIMIT 1",
      [brandId, identity.subCategory.id, identity.rasa.id]
    )
    : null;

  const identityConflict = identityMenu && (
    String(identityMenu.product_id || '') !== String(productId) ||
    Number(identityMenu.quantity || 0) !== 1
  ) ? ['MENU_SATUAN_IDENTITY_CONFLICT'] : [];

  const issues = uniqueSorted([
    ...identity.issues,
    ...identityConflict
  ]);

  const status = issues.length ? STATUS.NEEDS_REVIEW : STATUS.LEGACY;

  return {
    product_id: productId,
    product_name: inspected.product.name,
    status,
    issues,
    warnings: identity.warnings,
    source: {
      product_id: productId,
      category_id: inspected.product.category_id || null,
      product_name: inspected.product.name,
      price: Number(inspected.product.price),
      sku: inspected.product.sku || null,
      branch_products: inspected.legacy.branchProducts.length,
      historical_inventory_movements: inspected.legacy.historicalMovementCount,
      legacy_flavors: inspected.legacy.flavors.map(row => row.flavor_id),
      legacy_complements: inspected.legacy.complements.map(row => row.complement_id),
      legacy_levels: inspected.legacy.levels.map(row => row.level_id)
    },
    target: {
      menu_type: 'SINGLE',
      sub_category_id: identity.subCategory.id,
      sub_category_name: identity.subCategory.name,
      create_sub_category: Boolean(identity.subCategory.create),
      rasa_id: identity.rasa ? identity.rasa.id : null,
      rasa_name: identity.rasa ? identity.rasa.name : null,
      create_original_rasa: Boolean(identity.rasa && identity.rasa.create),
      level_id: identity.level ? identity.level.id : null,
      selling_price: Number(inspected.product.price),
      sku: identity.sku,
      sku_generated: !inspected.product.sku && identity.needsSku
    },
    existing_menu_id: identityMenu ? identityMenu.id : null,
    target_requires_owner_review: issues.length > 0,
    note: issues.length
      ? 'Legacy data was not mutated. Owner review is required before canonical Product → Menu migration.'
      : 'Deterministic migration candidate. No legacy complement/add-on data is auto-converted.'
  };
}

function canonicalFingerprint({ productId, menu, branches, inventory }) {
  const normalized = {
    product_id: String(productId),
    menu: {
      id: String(menu.id),
      type: menu.menu_type,
      sub_category_id: menu.sub_category_id,
      rasa_id: menu.rasa_id,
      level_id: menu.level_id,
      selling_price: Number(menu.selling_price),
      item_product_id: menu.item_product_id,
      item_quantity: Number(menu.item_quantity)
    },
    branches: (branches || []).map(row => ({
      branch_id: String(row.branch_id),
      menu_id: String(row.menu_id),
      is_available: Number(row.is_available),
      price_override: row.price_override == null ? null : Number(row.price_override),
      branch_category_ids: uniqueSorted(row.branch_category_ids || [])
    })).sort((a, b) => a.branch_id.localeCompare(b.branch_id)),
    inventory: (inventory || []).map(row => ({
      branch_id: String(row.branch_id),
      product_id: String(row.product_id),
      stock_qty: Number(row.stock_qty),
      low_stock_threshold: Number(row.low_stock_threshold)
    })).sort((a, b) => a.branch_id.localeCompare(b.branch_id))
  };
  return sha256(JSON.stringify(normalized));
}

function ensureOriginalRasa(brandId) {
  const existing = DataAccess.queryOne(
    "SELECT id, name, slug, is_active FROM menu_flavors WHERE brand_id = ? AND lower(trim(name)) = 'original' LIMIT 1",
    [brandId]
  );
  if (existing) {
    if (existing.is_active === 0) throw new Error('ORIGINAL_RASA_INACTIVE');
    return existing;
  }

  const id = 'rasa_' + sha256(String(brandId) + ':original').slice(0, 24);
  try {
    DataAccess.execute(
      "INSERT INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, 'Original', 'original', 0, 1)",
      [id, brandId]
    );
  } catch (err) {
    const retry = DataAccess.queryOne(
      "SELECT id, name, slug, is_active FROM menu_flavors WHERE brand_id = ? AND lower(trim(name)) = 'original' LIMIT 1",
      [brandId]
    );
    if (!retry) throw err;
    if (retry.is_active === 0) throw new Error('ORIGINAL_RASA_INACTIVE');
    return retry;
  }
  return DataAccess.queryOne(
    "SELECT id, name, slug, is_active FROM menu_flavors WHERE id = ? AND brand_id = ?",
    [id, brandId]
  );
}

function ensureSubCategory({ brandId, categoryId, name }) {
  const existing = DataAccess.queryOne(
    "SELECT id, brand_id, category_id, name, slug, is_active FROM sub_categories " +
    "WHERE brand_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1",
    [brandId, name]
  );

  if (existing) {
    if (String(existing.category_id) !== String(categoryId)) {
      throw new Error('SUB_CATEGORY_PARENT_CONFLICT');
    }
    if (existing.is_active === 0) throw new Error('SUB_CATEGORY_INACTIVE');
    return existing;
  }

  const id = 'subcat_' + sha256(String(brandId) + ':' + normalizeKey(name)).slice(0, 24);
  const slug = normalizeKey(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'subcategory';

  try {
    DataAccess.execute(
      "INSERT INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) " +
      "VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM sub_categories WHERE brand_id = ?), 0), 1)",
      [id, brandId, categoryId, name, slug, brandId]
    );
  } catch (err) {
    const retry = DataAccess.queryOne(
      "SELECT id, brand_id, category_id, name, slug, is_active FROM sub_categories " +
      "WHERE brand_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1",
      [brandId, name]
    );
    if (!retry) throw err;
    if (String(retry.category_id) !== String(categoryId)) throw new Error('SUB_CATEGORY_PARENT_CONFLICT');
    if (retry.is_active === 0) throw new Error('SUB_CATEGORY_INACTIVE');
    return retry;
  }

  return DataAccess.queryOne(
    "SELECT id, brand_id, category_id, name, slug, is_active FROM sub_categories WHERE id = ? AND brand_id = ?",
    [id, brandId]
  );
}

function ensureSingleMenu({ brandId, productId, categoryId, productName, price, rasaId, levelId, productActive }) {
  const subCategory = ensureSubCategory({
    brandId,
    categoryId,
    name: productName
  });

  const existing = DataAccess.queryOne(
    "SELECT m.id, m.brand_id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, m.selling_price, m.status, " +
    "mi.product_id AS item_product_id, mi.quantity AS item_quantity " +
    "FROM menus m LEFT JOIN menu_items mi ON mi.menu_id = m.id " +
    "WHERE m.brand_id = ? AND m.menu_type = 'SINGLE' AND m.sub_category_id = ? AND m.rasa_id = ? LIMIT 1",
    [brandId, subCategory.id, rasaId]
  );

  if (existing) {
    if (String(existing.item_product_id || '') !== String(productId) || Number(existing.item_quantity || 0) !== 1) {
      throw new Error('MENU_SATUAN_IDENTITY_CONFLICT');
    }

    // An existing exact Menu identity is already a canonical commercial entity.
    // Migration must not overwrite its selling price, lifecycle status, or level:
    // Product price is legacy migration input, while Menu owns commercial price.
    return DataAccess.queryOne(
      "SELECT id, brand_id, menu_type, sub_category_id, rasa_id, level_id, selling_price, status " +
      "FROM menus WHERE id = ? AND brand_id = ?",
      [existing.id, brandId]
    );
  }

  const menuId = 'menu_' + sha256(String(brandId) + ':' + String(productId) + ':single:' + String(rasaId)).slice(0, 24);
  DataAccess.execute(
    "INSERT INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, level_id, package_name, selling_price, status) " +
    "VALUES (?, ?, 'SINGLE', ?, ?, ?, NULL, ?, ?)",
    [menuId, brandId, subCategory.id, rasaId, levelId, Number(price), productActive ? 'ACTIVE' : 'ARCHIVED']
  );

  DataAccess.execute(
    "INSERT INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)",
    [menuId, productId]
  );

  return DataAccess.queryOne(
    "SELECT id, brand_id, menu_type, sub_category_id, rasa_id, level_id, selling_price, status " +
    "FROM menus WHERE id = ? AND brand_id = ?",
    [menuId, brandId]
  );
}

function migrateBranchState({ brandId, menuId, productId, branchRow, membershipRows }) {
  const branch = DataAccess.queryOne(
    "SELECT id, brand_id, is_active FROM branches WHERE id = ? AND brand_id = ?",
    [branchRow.branch_id, brandId]
  );
  if (!branch) throw new Error('BRANCH_NOT_FOUND');

  const branchCategories = new Set();

  if (branchRow.branch_category_id) branchCategories.add(String(branchRow.branch_category_id));
  for (const membership of membershipRows.filter(row => String(row.branch_id) === String(branchRow.branch_id))) {
    branchCategories.add(String(membership.branch_category_id));
  }

  for (const categoryId of branchCategories) {
    const category = DataAccess.queryOne(
      "SELECT id, brand_id, branch_id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?",
      [categoryId, branchRow.branch_id, brandId]
    );
    if (!category) throw new Error('BRANCH_CATEGORY_NOT_FOUND');
  }

  DataAccess.execute(
    "INSERT INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(branch_id, menu_id) DO UPDATE SET is_available = excluded.is_available, " +
    "price_override = excluded.price_override, updated_at = datetime('now')",
    [
      branchRow.branch_id,
      menuId,
      branchRow.is_available === null || branchRow.is_available === undefined ? 1 : Number(branchRow.is_available) ? 1 : 0,
      branchRow.price === null || branchRow.price === undefined ? null : Number(branchRow.price)
    ]
  );

  DataAccess.execute(
    "DELETE FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ?",
    [branchRow.branch_id, menuId]
  );

  for (const categoryId of branchCategories) {
    DataAccess.execute(
      "INSERT OR IGNORE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, ?)",
      [branchRow.branch_id, menuId, categoryId]
    );
  }

  const skuProduct = DataAccess.queryOne(
    "SELECT sku FROM products WHERE id = ? AND brand_id = ?",
    [productId, brandId]
  );
  const sku = skuProduct && normalizeText(skuProduct.sku);
  if (!sku) return null;

  const legacyStock = numberOrNull(branchRow.stock);
  if (legacyStock === null) return null;

  const existingInventory = DataAccess.queryOne(
    "SELECT stock_qty, low_stock_threshold FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?",
    [branchRow.branch_id, productId]
  );

  if (existingInventory && Number(existingInventory.stock_qty) !== Number(legacyStock)) {
    throw new Error('CANONICAL_INVENTORY_CONFLICT');
  }

  DataAccess.execute(
    "INSERT INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(branch_id, product_id) DO UPDATE SET low_stock_threshold = excluded.low_stock_threshold, updated_at = datetime('now')",
    [
      branchRow.branch_id,
      productId,
      Math.max(0, Number(legacyStock)),
      Number.isInteger(Number(branchRow.low_stock_threshold)) ? Math.max(0, Number(branchRow.low_stock_threshold)) : 5
    ]
  );

  return DataAccess.queryOne(
    "SELECT branch_id, product_id, stock_qty, low_stock_threshold FROM branch_product_inventory " +
    "WHERE branch_id = ? AND product_id = ?",
    [branchRow.branch_id, productId]
  );
}

function applyProduct({ brandId, productId }) {
  const plan = buildPlan({ brandId, productId });
  if (plan.status !== STATUS.LEGACY) {
    migrationRepository.record({
      brandId,
      productId,
      status: STATUS.NEEDS_REVIEW,
      notes: plan.note,
      lastError: plan.issues.join(', '),
      sourceSnapshot: JSON.stringify(plan.source)
    });
    return Object.assign(plan, { applied: false, persisted: true });
  }

  const inspected = inspectProduct({ brandId, productId });
  let menu = null;
  const branchResults = [];
  const inventoryResults = [];

  DataAccess.exec('BEGIN IMMEDIATE');
  try {
    const identity = plan.target;

    if (identity.sku && !normalizeText(inspected.product.sku)) {
      DataAccess.execute(
        "UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
        [identity.sku, productId, brandId]
      );
      DataAccess.execute(
        "INSERT INTO product_sku_history (id, brand_id, product_id, previous_sku, new_sku, actor_id, actor_role) " +
        "VALUES (?, ?, ?, NULL, ?, NULL, 'migration')",
        ['skuhist_' + sha256(String(brandId) + ':' + productId + ':' + identity.sku).slice(0, 24), brandId, productId, identity.sku]
      );
    }

    const category = DataAccess.queryOne(
      "SELECT id, is_active FROM categories WHERE id = ? AND brand_id = ?",
      [inspected.product.category_id, brandId]
    );
    if (!category) throw new Error('MASTER_CATEGORY_REQUIRED');
    if (category.is_active === 0) throw new Error('MASTER_CATEGORY_INACTIVE');

    const rasa = identity.create_original_rasa ? ensureOriginalRasa(brandId) : DataAccess.queryOne(
      "SELECT id, is_active FROM menu_flavors WHERE id = ? AND brand_id = ?",
      [identity.rasa_id, brandId]
    );
    if (!rasa || rasa.is_active === 0) throw new Error('RASA_NOT_FOUND_OR_INACTIVE');

    menu = ensureSingleMenu({
      brandId,
      productId,
      categoryId: inspected.product.category_id,
      productName: inspected.product.name,
      price: inspected.product.price,
      rasaId: rasa.id,
      levelId: identity.level_id,
      productActive: inspected.product.is_active !== 0
    });

    const memberships = inspected.legacy.branchMemberships;
    for (const branchRow of inspected.legacy.branchProducts) {
      const inventory = migrateBranchState({
        brandId,
        menuId: menu.id,
        productId,
        branchRow,
        membershipRows: memberships
      });
      branchResults.push({
        branch_id: branchRow.branch_id,
        is_available: branchRow.is_available == null ? 1 : Number(branchRow.is_available) ? 1 : 0,
        price_override: branchRow.price == null ? null : Number(branchRow.price)
      });
      if (inventory) inventoryResults.push(inventory);
    }

    const inventoryFallback = DataAccess.queryMany(
      "SELECT bpi.branch_id, bpi.product_id, bpi.stock_qty, bpi.low_stock_threshold " +
      "FROM branch_product_inventory bpi JOIN branches b ON b.id = bpi.branch_id AND b.brand_id = ? " +
      "WHERE bpi.product_id = ? ORDER BY bpi.branch_id ASC",
      [brandId, productId]
    );

    const finalMenu = DataAccess.queryOne(
      "SELECT m.id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, m.selling_price, " +
      "mi.product_id AS item_product_id, mi.quantity AS item_quantity FROM menus m " +
      "JOIN menu_items mi ON mi.menu_id = m.id WHERE m.id = ? AND m.brand_id = ?",
      [menu.id, brandId]
    );

    const branchFingerprintRows = DataAccess.queryMany(
      "SELECT bm.branch_id, bm.menu_id, bm.is_available, bm.price_override FROM branch_menus bm " +
      "JOIN branches b ON b.id = bm.branch_id AND b.brand_id = ? WHERE bm.menu_id = ? ORDER BY bm.branch_id ASC",
      [brandId, menu.id]
    );
    for (const row of branchFingerprintRows) {
      row.branch_category_ids = DataAccess.queryMany(
        "SELECT branch_category_id FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ? ORDER BY branch_category_id ASC",
        [row.branch_id, menu.id]
      ).map(x => x.branch_category_id);
    }

    const fingerprint = canonicalFingerprint({
      productId,
      menu: finalMenu,
      branches: branchFingerprintRows,
      inventory: inventoryFallback
    });

    migrationRepository.record({
      brandId,
      productId,
      status: STATUS.MIGRATED,
      canonicalFingerprint: fingerprint,
      sourceSnapshot: JSON.stringify(plan.source),
      notes: plan.note,
      lastError: null,
      verified: false
    });

    DataAccess.exec('COMMIT');

    return Object.assign(plan, {
      status: STATUS.MIGRATED,
      applied: true,
      persisted: true,
      menu_id: menu.id,
      canonical_fingerprint: fingerprint,
      branch_results: branchResults,
      inventory_results: inventoryResults
    });
  } catch (err) {
    try { DataAccess.exec('ROLLBACK'); } catch (_) {}
    const message = String(err && err.message || err);
    try {
      migrationRepository.record({
        brandId,
        productId,
        status: STATUS.FAILED,
        lastError: message,
        sourceSnapshot: JSON.stringify(plan.source),
        notes: 'Migration transaction rolled back; no canonical business mutation was committed.'
      });
    } catch (_) {}
    throw err;
  }
}

function verifyProduct({ brandId, productId }) {
  const inspected = inspectProduct({ brandId, productId });
  const identity = planIdentity(inspected);
  const menu = identity.rasa && identity.rasa.id && identity.subCategory && identity.subCategory.id
    ? DataAccess.queryOne(
      "SELECT m.id, m.brand_id, m.menu_type, m.sub_category_id, m.rasa_id, m.level_id, m.selling_price, " +
      "mi.product_id AS item_product_id, mi.quantity AS item_quantity " +
      "FROM menus m JOIN menu_items mi ON mi.menu_id = m.id " +
      "WHERE m.brand_id = ? AND m.menu_type = 'SINGLE' " +
      "AND m.sub_category_id = ? AND m.rasa_id = ? LIMIT 1",
      [brandId, identity.subCategory.id, identity.rasa.id]
    )
    : null;

  const errors = [];
  if (!menu) {
    errors.push('MENU_SATUAN_NOT_FOUND');
  } else {
    if (String(menu.item_product_id) !== String(productId)) errors.push('MENU_PRODUCT_REFERENCE_INVALID');

    const sub = DataAccess.queryOne(
      "SELECT id, brand_id, category_id, is_active FROM sub_categories WHERE id = ? AND brand_id = ?",
      [menu.sub_category_id, brandId]
    );
    if (!sub) {
      errors.push('SUB_CATEGORY_NOT_FOUND');
    } else if (String(sub.category_id) !== String(inspected.product.category_id)) {
      errors.push('SUB_CATEGORY_PARENT_MISMATCH');
    }

    const rasa = DataAccess.queryOne(
      "SELECT id, brand_id, name, is_active FROM menu_flavors WHERE id = ? AND brand_id = ?",
      [menu.rasa_id, brandId]
    );
    if (!rasa) errors.push('RASA_NOT_FOUND');
    else if (rasa.is_active === 0) errors.push('RASA_INACTIVE');

    const componentCount = DataAccess.queryOne(
      "SELECT COUNT(*) AS count, MIN(quantity) AS min_quantity, MAX(quantity) AS max_quantity " +
      "FROM menu_items WHERE menu_id = ?",
      [menu.id]
    );
    if (Number(componentCount.count) !== 1 || Number(componentCount.min_quantity) !== 1 || Number(componentCount.max_quantity) !== 1) {
      errors.push('MENU_SATUAN_COMPOSITION_INVALID');
    }

    const sourceBranchCount = DataAccess.queryOne(
      "SELECT COUNT(*) AS count FROM branch_products WHERE product_id = ?",
      [productId]
    );
    const targetBranchCount = DataAccess.queryOne(
      "SELECT COUNT(*) AS count FROM branch_menus WHERE menu_id = ?",
      [menu.id]
    );
    if (Number(sourceBranchCount.count) !== Number(targetBranchCount.count)) {
      errors.push('BRANCH_MENU_MIGRATION_INCOMPLETE');
    }

    const sku = normalizeText(inspected.product.sku);
    const sourcePositiveStock = inspected.legacy.branchProducts.some(row => {
      const stock = numberOrNull(row.stock);
      return stock !== null && stock > 0;
    });
    if ((sourcePositiveStock || inspected.legacy.historicalMovementCount > 0) && !sku) {
      errors.push('SKU_REQUIRED_FOR_STOCK');
    }

    if (sku) {
      const conflicts = DataAccess.queryOne(
        "SELECT COUNT(*) AS count FROM products WHERE brand_id = ? AND lower(trim(sku)) = lower(trim(?)) AND id <> ?",
        [brandId, sku, productId]
      );
      if (Number(conflicts.count) > 0) errors.push('PRODUCT_SKU_NOT_UNIQUE');
      const sourceWithStock = DataAccess.queryMany(
        "SELECT branch_id, stock FROM branch_products WHERE product_id = ? AND stock IS NOT NULL ORDER BY branch_id ASC",
        [productId]
      );
      for (const row of sourceWithStock) {
        const target = DataAccess.queryOne(
          "SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?",
          [row.branch_id, productId]
        );
        if (!target || Number(target.stock_qty) !== Math.max(0, Number(row.stock))) {
          errors.push('BRANCH_INVENTORY_MIGRATION_INCOMPLETE');
          break;
        }
      }
    }
  }

  const status = errors.length ? STATUS.NEEDS_REVIEW : STATUS.VERIFIED;
  const migration = migrationRepository.record({
    brandId,
    productId,
    status,
    canonicalFingerprint: null,
    notes: errors.length ? errors.join(', ') : 'Canonical Product → Menu migration verified.',
    lastError: errors.length ? errors.join(', ') : null,
    sourceSnapshot: JSON.stringify({
      product_id: productId,
      branch_products: inspected.legacy.branchProducts.length
    }),
    verified: status === STATUS.VERIFIED
  });

  return {
    product_id: productId,
    status,
    errors,
    migration
  };
}

function reconcileProduct({ brandId, productId, apply = false, persistReport = apply }) {
  const plan = buildPlan({ brandId, productId });
  if (apply) return applyProduct({ brandId, productId });

  if (!persistReport) {
    return Object.assign(plan, {
      applied: false,
      persisted: false
    });
  }

  const migration = migrationRepository.record({
    brandId,
    productId,
    status: plan.status === STATUS.NEEDS_REVIEW ? STATUS.NEEDS_REVIEW : STATUS.LEGACY,
    notes: plan.note,
    lastError: plan.issues.length ? plan.issues.join(', ') : null,
    sourceSnapshot: JSON.stringify(plan.source)
  });

  return Object.assign(plan, {
    applied: false,
    persisted: true,
    migration
  });
}

function reconcileBrand({ brandId, verify = false, apply = false, persistReport = apply }) {
  ensureComposedMenuSchema(DataAccess);
  if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

  const products = DataAccess.queryMany(
    "SELECT id FROM products WHERE brand_id = ? ORDER BY id ASC",
    [brandId]
  );

  const results = products.map(row => {
    try {
      return verify
        ? verifyProduct({ brandId, productId: row.id })
        : reconcileProduct({ brandId, productId: row.id, apply, persistReport });
    } catch (err) {
      return {
        product_id: row.id,
        status: STATUS.FAILED,
        applied: false,
        persisted: Boolean(apply || persistReport),
        errors: [String(err && err.message || err)]
      };
    }
  });

  const summary = results.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {
    total: 0,
    legacy: 0,
    needs_review: 0,
    migrated: 0,
    verified: 0,
    failed: 0
  });

  return { brand_id: brandId, summary, results };
}

function listStatus({ brandId, status = null }) {
  ensureComposedMenuSchema(DataAccess);
  if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
  if (status && !Object.values(STATUS).includes(status)) throw new Error('INVALID_COMPOSED_MIGRATION_STATUS');
  return migrationRepository.list({ brandId, status });
}

module.exports = {
  ComposedMenuMigrationService: {
    inspectProduct,
    planProductMigration: buildPlan,
    reconcileProduct,
    reconcileBrand,
    applyProductMigration: applyProduct,
    verifyProduct,
    listStatus
  },
  STATUS,
  generatedSku,
  canonicalFingerprint
};
