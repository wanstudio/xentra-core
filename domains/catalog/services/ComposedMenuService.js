'use strict';

const crypto = require('crypto');
const ComposedMenuRepository = require('../repositories/ComposedMenuRepository');

const repository = new ComposedMenuRepository();

function makeId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '');
}

function normalizeName(value, code) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw new Error(code || 'NAME_REQUIRED');
  if (name.length > 255) throw new Error('NAME_TOO_LONG');
  return name;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw new Error('MENU_PRICE_INVALID');
  return price;
}

function normalizeStatus(value) {
  const status = String(value || 'DRAFT').trim().toUpperCase();
  if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) {
    throw new Error('MENU_STATUS_INVALID');
  }
  return status;
}

function normalizeSku(value) {
  if (value === undefined || value === null) return null;
  const sku = String(value).trim();
  return sku ? sku : null;
}

function ensureSchema() {
  repository.ensureSchema();
}

function normalizeLevelId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function normalizeRasaId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function normalizeProductComponents(value) {
  if (!Array.isArray(value)) throw new Error('MENU_PACKAGE_COMPONENTS_REQUIRED');

  const components = value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error('MENU_PACKAGE_COMPONENT_INVALID');
    }

    const productId = String(item.product_id ?? item.productId ?? '').trim();
    if (!productId) throw new Error('MENU_PACKAGE_PRODUCT_REQUIRED');

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('MENU_PACKAGE_COMPONENT_QUANTITY_INVALID');
    }

    return { productId, quantity, inputIndex: index };
  });

  const seen = new Set();
  for (const component of components) {
    if (seen.has(component.productId)) {
      throw new Error('MENU_PACKAGE_DUPLICATE_PRODUCT');
    }
    seen.add(component.productId);
  }

  const totalUnits = components.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits < 2) throw new Error('MENU_PACKAGE_MIN_TWO_UNITS');

  return components;
}

class ComposedMenuService {
  static setProductSku({
    ensureSchema(); brandId, productId, sku, actorId = null, actorRole = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const product = repository.findProductSku({ brandId, productId });
    if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');

    const previousSku = product.sku == null ? null : String(product.sku).trim() || null;
    const normalized = normalizeSku(sku);

    // Removing stock identity is a governed operation. It is not allowed while any
    // active branch still has positive stock in either the new inventory table or
    // the legacy compatibility stock column.
    if (previousSku && !normalized) {
      const positiveStock = repository.db.queryOne(
        "SELECT 1 AS found FROM branches b " +
        "LEFT JOIN branch_product_inventory bpi ON bpi.branch_id = b.id AND bpi.product_id = ? " +
        "LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ? " +
        "WHERE b.brand_id = ? AND b.is_active = 1 " +
        "AND (COALESCE(bpi.stock_qty, 0) > 0 OR COALESCE(bp.stock, 0) > 0) LIMIT 1",
        [productId, productId, brandId]
      );
      if (positiveStock) throw new Error('PRODUCT_SKU_REMOVAL_BLOCKED_STOCK');
    }

    if (previousSku === normalized) return repository.findProductSku({ brandId, productId });

    repository.begin();
    try {
      repository.updateProductSku({
        brandId,
        productId,
        sku: normalized
      });
      repository.db.execute(
        "INSERT INTO product_sku_history (id, brand_id, product_id, previous_sku, new_sku, actor_id, actor_role) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [makeId('skuhist'), brandId, productId, previousSku, normalized, actorId, actorRole]
      );
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        if (/idx_products_brand_sku_normalized/i.test(String(err && err.message))) {
          throw new Error('PRODUCT_SKU_ALREADY_EXISTS');
        }
      }
      if (/PRODUCT_SKU_EMPTY/i.test(String(err && err.message))) {
        throw new Error('PRODUCT_SKU_EMPTY');
      }
      throw err;
    }

    return repository.findProductSku({ brandId, productId });
  }

  static listSubCategories({
    ensureSchema(); brandId, categoryId = null, activeOnly = false }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listSubCategories({ brandId, categoryId, activeOnly });
  }

  static createSubCategory({
    ensureSchema(); brandId, categoryId, name, slug = null, sortOrder = 0 }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!categoryId) throw new Error('CATEGORY_REQUIRED');

    const category = repository.findCategory({ brandId, categoryId });
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    if (category.is_active === 0) throw new Error('CATEGORY_INACTIVE');

    const normalizedName = normalizeName(name, 'SUB_CATEGORY_NAME_REQUIRED');
    const duplicate = repository.findSubCategoryByName({
      brandId,
      name: normalizedName
    });
    if (duplicate) throw new Error('SUB_CATEGORY_ALREADY_EXISTS');

    const normalizedSlug = slugify(slug || normalizedName);
    if (!normalizedSlug) throw new Error('SUB_CATEGORY_SLUG_REQUIRED');

    const id = makeId('subcat');
    try {
      repository.createSubCategory({
        id,
        brandId,
        categoryId,
        name: normalizedName,
        slug: normalizedSlug,
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0
      });
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        throw new Error('SUB_CATEGORY_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findSubCategory({ brandId, subCategoryId: id });
  }

  static listRasas({
    ensureSchema(); brandId, activeOnly = false }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listRasas({ brandId, activeOnly });
  }

  static ensureOriginalRasa({
    ensureSchema(); brandId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const existing = repository.findRasaByName({ brandId, name: 'Original' });
    if (existing) return existing;

    const id = makeId('rasa');
    try {
      repository.createRasa({
        id,
        brandId,
        name: 'Original',
        slug: 'original',
        sortOrder: 0
      });
    } catch (err) {
      if (!/UNIQUE constraint failed/i.test(String(err && err.message))) throw err;
    }
    return repository.findRasaByName({ brandId, name: 'Original' });
  }

  static createRasa({
    ensureSchema(); brandId, name, slug = null, sortOrder = 0 }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedName = normalizeName(name, 'RASA_NAME_REQUIRED');
    const existing = repository.findRasaByName({ brandId, name: normalizedName });
    if (existing) throw new Error('RASA_ALREADY_EXISTS');

    const normalizedSlug = slugify(slug || normalizedName);
    if (!normalizedSlug) throw new Error('RASA_SLUG_REQUIRED');

    const id = makeId('rasa');
    try {
      repository.createRasa({
        id,
        brandId,
        name: normalizedName,
        slug: normalizedSlug,
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0
      });
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        throw new Error('RASA_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findRasa({ brandId, rasaId: id });
  }

  static createSingleMenu({
    ensureSchema();
    brandId,
    productId,
    subCategoryId,
    rasaId = null,
    levelId = null,
    sellingPrice,
    status = 'DRAFT'
  }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const product = repository.findProduct({ brandId, productId });
    if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
    if (product.is_active === 0) throw new Error('MASTER_PRODUCT_INACTIVE');

    const subCategory = repository.findSubCategory({ brandId, subCategoryId });
    if (!subCategory) throw new Error('SUB_CATEGORY_NOT_FOUND');
    if (subCategory.is_active === 0) throw new Error('SUB_CATEGORY_INACTIVE');

    const resolvedRasa = rasaId
      ? repository.findRasa({ brandId, rasaId })
      : this.ensureOriginalRasa({ brandId });

    if (!resolvedRasa) throw new Error('RASA_NOT_FOUND');
    if (resolvedRasa.is_active === 0) throw new Error('RASA_INACTIVE');

    const normalizedLevelId = normalizeLevelId(levelId);
    if (normalizedLevelId) {
      const level = repository.findLevel({ brandId, levelId: normalizedLevelId });
      if (!level) throw new Error('LEVEL_NOT_FOUND');
      if (level.is_active === 0) throw new Error('LEVEL_INACTIVE');
    }

    const price = normalizePrice(sellingPrice);
    const menuStatus = normalizeStatus(status);

    const duplicate = repository.findSingleMenuByIdentity({
      brandId,
      subCategoryId,
      rasaId: resolvedRasa.id
    });
    if (duplicate) throw new Error('MENU_SATUAN_ALREADY_EXISTS');

    const id = makeId('menu');

    repository.begin();
    try {
      repository.createMenu({
        id,
        brandId,
        menuType: 'SINGLE',
        subCategoryId,
        rasaId: resolvedRasa.id,
        levelId: normalizedLevelId,
        packageName: null,
        sellingPrice: price,
        status: menuStatus
      });

      repository.replaceMenuItems({
        menuId: id,
        items: [{ productId: product.id, quantity: 1 }]
      });

      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      if (/UNIQUE constraint failed.*idx_menus_single_identity/i.test(String(err && err.message))) {
        throw new Error('MENU_SATUAN_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findMenu({ brandId, menuId: id });
  }

  static updateSingleMenu({
    brandId,
    menuId,
    productId,
    subCategoryId,
    rasaId = undefined,
    levelId = undefined,
    sellingPrice,
    status = undefined
  }) {
    ensureSchema();
    const current = repository.findMenu({ brandId, menuId });
    if (!current) throw new Error('MENU_NOT_FOUND');
    if (current.menu_type !== 'SINGLE') throw new Error('MENU_TYPE_MISMATCH');

    const nextProductId = productId === undefined ? null : String(productId);
    const nextSubCategoryId = subCategoryId === undefined ? current.sub_category_id : subCategoryId;
    const nextRasaId = rasaId === undefined ? current.rasa_id : (rasaId || null);
    const nextLevelId = levelId === undefined ? current.level_id : (levelId || null);
    const nextPrice = sellingPrice === undefined ? Number(current.selling_price) : normalizePrice(sellingPrice);
    const nextStatus = status === undefined ? current.status : normalizeStatus(status);

    const product = repository.findProduct({ brandId, productId: nextProductId || (repository.listMenuItems({ brandId, menuIds: [menuId] })[0] || {}).product_id });
    if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
    const existingItem = repository.listMenuItems({ brandId, menuIds: [menuId] })[0];
    if (product.is_active === 0 && (!existingItem || String(existingItem.product_id) !== String(product.id))) {
      throw new Error('MASTER_PRODUCT_INACTIVE');
    }

    const sub = repository.findSubCategory({ brandId, subCategoryId: nextSubCategoryId });
    if (!sub) throw new Error('SUB_CATEGORY_NOT_FOUND');
    if (sub.is_active === 0 && String(sub.id) !== String(current.sub_category_id)) {
      throw new Error('SUB_CATEGORY_INACTIVE');
    }

    let rasa = nextRasaId ? repository.findRasa({ brandId, rasaId: nextRasaId }) : null;
    if (!rasa) rasa = this.ensureOriginalRasa({ brandId });
    if (rasa.is_active === 0 && String(rasa.id) !== String(current.rasa_id)) throw new Error('RASA_INACTIVE');

    if (nextLevelId) {
      const level = repository.findLevel({ brandId, levelId: nextLevelId });
      if (!level) throw new Error('LEVEL_NOT_FOUND');
      if (level.is_active === 0 && String(level.id) !== String(current.level_id)) throw new Error('LEVEL_INACTIVE');
    }

    const duplicate = repository.findSingleMenuByIdentity({
      brandId,
      subCategoryId: sub.id,
      rasaId: rasa.id
    });
    if (duplicate && String(duplicate.id) !== String(menuId)) throw new Error('MENU_SATUAN_ALREADY_EXISTS');

    repository.begin();
    try {
      repository.updateMenu({
        brandId,
        menuId,
        fields: {
          sub_category_id: sub.id,
          rasa_id: rasa.id,
          level_id: nextLevelId,
          package_name: null,
          selling_price: nextPrice,
          status: nextStatus
        }
      });
      repository.replaceMenuItems({ menuId, items: [{ productId: product.id, quantity: 1 }] });
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return repository.findMenu({ brandId, menuId });
  }

  static updatePackageMenu({
    brandId,
    menuId,
    packageName,
    sellingPrice,
    subCategoryId = undefined,
    rasaId = undefined,
    levelId = undefined,
    components,
    status = undefined
  }) {
    ensureSchema();
    const current = repository.findMenu({ brandId, menuId });
    if (!current) throw new Error('MENU_NOT_FOUND');
    if (current.menu_type !== 'PACKAGE') throw new Error('MENU_TYPE_MISMATCH');

    const currentItems = repository.listMenuItems({ brandId, menuIds: [menuId] });
    const normalizedComponents = components === undefined
      ? currentItems.map(item => ({ productId: item.product_id, quantity: Number(item.quantity) }))
      : normalizeProductComponents(components);

    const nextPackageName = packageName === undefined
      ? current.package_name
      : normalizeName(packageName, 'MENU_PACKAGE_NAME_REQUIRED');
    const nextPrice = sellingPrice === undefined ? Number(current.selling_price) : normalizePrice(sellingPrice);
    const nextSubCategoryId = subCategoryId === undefined ? current.sub_category_id : (subCategoryId || null);
    const nextRasaId = rasaId === undefined ? current.rasa_id : (rasaId || null);
    const nextLevelId = levelId === undefined ? current.level_id : (levelId || null);
    const nextStatus = status === undefined ? current.status : normalizeStatus(status);

    const sub = nextSubCategoryId ? repository.findSubCategory({ brandId, subCategoryId: nextSubCategoryId }) : null;
    if (nextSubCategoryId && !sub) throw new Error('SUB_CATEGORY_NOT_FOUND');
    if (sub && sub.is_active === 0 && String(sub.id) !== String(current.sub_category_id)) throw new Error('SUB_CATEGORY_INACTIVE');

    const rasa = nextRasaId ? repository.findRasa({ brandId, rasaId: nextRasaId }) : null;
    if (nextRasaId && !rasa) throw new Error('RASA_NOT_FOUND');
    if (rasa && rasa.is_active === 0 && String(rasa.id) !== String(current.rasa_id)) throw new Error('RASA_INACTIVE');

    if (nextLevelId) {
      const level = repository.findLevel({ brandId, levelId: nextLevelId });
      if (!level) throw new Error('LEVEL_NOT_FOUND');
      if (level.is_active === 0 && String(level.id) !== String(current.level_id)) throw new Error('LEVEL_INACTIVE');
    }

    for (const component of normalizedComponents) {
      const product = repository.findProduct({ brandId, productId: component.productId });
      if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
      if (product.is_active === 0 && !currentItems.some(item => String(item.product_id) === String(component.productId))) {
        throw new Error('MASTER_PRODUCT_INACTIVE');
      }
    }

    repository.begin();
    try {
      repository.updateMenu({
        brandId,
        menuId,
        fields: {
          sub_category_id: nextSubCategoryId,
          rasa_id: nextRasaId,
          level_id: nextLevelId,
          package_name: nextPackageName,
          selling_price: nextPrice,
          status: nextStatus
        }
      });
      repository.replaceMenuItems({ menuId, items: normalizedComponents });
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return repository.findMenu({ brandId, menuId });
  }

  static createPackageMenu({
    ensureSchema();
    brandId,
    packageName,
    sellingPrice,
    subCategoryId = null,
    rasaId = null,
    levelId = null,
    components,
    status = 'DRAFT'
  }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const normalizedPackageName = normalizeName(packageName, 'MENU_PACKAGE_NAME_REQUIRED');
    const normalizedComponents = normalizeProductComponents(components);
    const price = normalizePrice(sellingPrice);
    const menuStatus = normalizeStatus(status);

    let subCategory = null;
    if (subCategoryId) {
      subCategory = repository.findSubCategory({ brandId, subCategoryId });
      if (!subCategory) throw new Error('SUB_CATEGORY_NOT_FOUND');
      if (subCategory.is_active === 0) throw new Error('SUB_CATEGORY_INACTIVE');
    }

    let resolvedRasa = null;
    const normalizedRasaId = normalizeRasaId(rasaId);
    if (normalizedRasaId) {
      resolvedRasa = repository.findRasa({ brandId, rasaId: normalizedRasaId });
      if (!resolvedRasa) throw new Error('RASA_NOT_FOUND');
      if (resolvedRasa.is_active === 0) throw new Error('RASA_INACTIVE');
    }

    const normalizedLevelId = normalizeLevelId(levelId);
    if (normalizedLevelId) {
      const level = repository.findLevel({ brandId, levelId: normalizedLevelId });
      if (!level) throw new Error('LEVEL_NOT_FOUND');
      if (level.is_active === 0) throw new Error('LEVEL_INACTIVE');
    }

    const products = normalizedComponents.map(component => {
      const product = repository.findProduct({ brandId, productId: component.productId });
      if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
      if (product.is_active === 0) throw new Error('MASTER_PRODUCT_INACTIVE');
      return product;
    });

    const id = makeId('menu');
    repository.begin();
    try {
      repository.createMenu({
        id,
        brandId,
        menuType: 'PACKAGE',
        subCategoryId: subCategory ? subCategory.id : null,
        rasaId: resolvedRasa ? resolvedRasa.id : null,
        levelId: normalizedLevelId,
        packageName: normalizedPackageName,
        sellingPrice: price,
        status: menuStatus
      });

      repository.replaceMenuItems({
        menuId: id,
        items: normalizedComponents.map(item => ({
          productId: item.productId,
          quantity: item.quantity
        }))
      });

      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return repository.findMenu({ brandId, menuId: id });
  }

  static setMenuStatus({
    ensureSchema(); brandId, menuId, status }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    const nextStatus = normalizeStatus(status);
    repository.db.execute(
      "UPDATE menus SET status = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [nextStatus, menuId, brandId]
    );
    return repository.findMenu({ brandId, menuId });
  }

  static adoptMenuToBranch({
    ensureSchema();
    brandId,
    branchId,
    menuId,
    isAvailable = true,
    priceOverride = null,
    branchCategoryIds = []
  }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    const normalizedPriceOverride = priceOverride === null || priceOverride === undefined
      ? null
      : normalizePrice(priceOverride);

    repository.begin();
    try {
      repository.upsertBranchMenu({
        brandId,
        branchId,
        menuId,
        isAvailable: Boolean(isAvailable),
        priceOverride: normalizedPriceOverride
      });
      repository.replaceBranchMenuCategories({
        brandId,
        branchId,
        menuId,
        branchCategoryIds
      });
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return {
      branch_menu: repository.findBranchMenu({ brandId, branchId, menuId }),
      categories: repository.listBranchMenuCategoryMemberships({
        brandId,
        branchId,
        menuId
      })
    };
  }

  static listMenus({
    ensureSchema(); brandId, menuType = null, status = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listMenus({
      brandId,
      menuType,
      status: status ? normalizeStatus(status) : null
    });
  }
}

module.exports = ComposedMenuService;
