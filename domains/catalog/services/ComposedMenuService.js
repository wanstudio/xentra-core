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

// Contract v4 (docs/decisions/catalog-menu-domain-contract-v4.md §11):
// Pedas adalah atribut opsional Menu — checkbox + selector 4 posisi horizontal.
// Bukan dropdown, tanpa Master Level domain. Nilai posisi 1-4 adalah
// implementation detail, bukan named level.
function normalizeSpice(spiceEnabled, spiceLevel) {
  const enabled = spiceEnabled === true || spiceEnabled === 1 || spiceEnabled === 'true' || spiceEnabled === '1';
  if (!enabled) return { enabled: 0, level: null };
  const n = Number(spiceLevel);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error('MENU_SPICE_LEVEL_INVALID');
  return { enabled: 1, level: n };
}

function normalizeSku(value) {
  if (value === undefined || value === null) return null;
  const sku = String(value).trim();
  return sku ? sku : null;
}

function ensureSchema() {
  repository.ensureSchema();
}

function normalizeRasaId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

class ComposedMenuService {
  static setProductSku({
    brandId, productId, sku, actorId = null, actorRole = null
  }) {
    ensureSchema();
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

      if (normalized) {
        // Adding SKU later must have the same stockability semantics as
        // creating a Product with SKU from the start.
        repository.ensureSkuProductInventoryForActiveBranches({
          brandId,
          productId
        });
      }

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

  static listRasas({
    brandId, activeOnly = false
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listRasas({ brandId, activeOnly });
  }

  static ensureOriginalRasa({
    brandId
  }) {
    ensureSchema();
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
      const message = String(err && err.message || err);
      if (!/UNIQUE constraint failed/i.test(message) && !/RASA_ALREADY_EXISTS/i.test(message)) throw err;
    }
    return repository.findRasaByName({ brandId, name: 'Original' });
  }

  static createRasa({
    brandId, name, slug = null, sortOrder = 0
  }) {
    ensureSchema();
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
      const message = String(err && err.message || err);
      if (/UNIQUE constraint failed/i.test(message) || /RASA_ALREADY_EXISTS/i.test(message)) {
        throw new Error('RASA_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findRasa({ brandId, rasaId: id });
  }

  static normalizeMenuItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('MENU_ITEMS_REQUIRED');
    }
    const seen = new Set();
    return items.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error('MENU_ITEM_INVALID');
      }
      const productId = String(item.product_id ?? item.productId ?? '').trim();
      if (!productId) throw new Error('MENU_ITEM_PRODUCT_REQUIRED');
      if (seen.has(productId)) throw new Error('MENU_ITEM_DUPLICATE_PRODUCT');
      seen.add(productId);

      const quantity = Number(item.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('MENU_ITEM_QUANTITY_INVALID');
      }
      return { productId, quantity, sortOrder: index };
    });
  }

  /**
   * Contract v4 Canonical Menu Creation (§1, §2, §3, §4, §7, §9, §11, §14):
   * - Category: required
   * - Judul (titleId): required
   * - Rasa (rasaId): optional / null
   * - Items: Product x quantity (1 or many)
   * - Harga & Modal: independent Menu fields
   * - Pedas: optional checkbox (spiceEnabled) + 1..4 scale (spiceLevel)
   */
  static createMenu({
    brandId,
    categoryId,
    titleId,
    rasaId = null,
    spiceEnabled = false,
    spiceLevel = null,
    sellingPrice,
    costPrice = 0,
    items,
    status = 'DRAFT'
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!categoryId) throw new Error('CATEGORY_REQUIRED');
    if (!titleId) throw new Error('TITLE_REQUIRED');

    const category = repository.findCategory({ brandId, categoryId });
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    if (category.is_active === 0) throw new Error('CATEGORY_INACTIVE');

    const title = ComposedMenuService.findMenuTitle({ brandId, titleId });
    if (!title) throw new Error('TITLE_NOT_FOUND');
    if (title.is_active === 0) throw new Error('TITLE_INACTIVE');

    let resolvedRasa = null;
    const normalizedRasaId = normalizeRasaId(rasaId);
    if (normalizedRasaId) {
      resolvedRasa = repository.findRasa({ brandId, rasaId: normalizedRasaId });
      if (!resolvedRasa) throw new Error('RASA_NOT_FOUND');
      if (resolvedRasa.is_active === 0) throw new Error('RASA_INACTIVE');
    }

    const normalizedItems = ComposedMenuService.normalizeMenuItems(items);
    const spice = normalizeSpice(spiceEnabled, spiceLevel);
    const price = normalizePrice(sellingPrice);
    const cost = normalizePrice(costPrice);
    const menuStatus = normalizeStatus(status);

    for (const item of normalizedItems) {
      const product = repository.findProduct({ brandId, productId: item.productId });
      if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
      if (product.is_active === 0 && menuStatus !== 'DRAFT') {
        throw new Error('MASTER_PRODUCT_INACTIVE');
      }
    }

    const id = makeId('menu');
    repository.begin();
    try {
      repository.createMenu({
        id,
        brandId,
        menuType: null,
        categoryId: category.id,
        titleId: title.id,
        rasaId: resolvedRasa ? resolvedRasa.id : null,
        packageName: null,
        sellingPrice: price,
        costPrice: cost,
        spiceEnabled: spice.enabled,
        spiceLevel: spice.level,
        status: menuStatus
      });

      repository.replaceMenuItems({
        menuId: id,
        items: normalizedItems
      });

      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return repository.findMenu({ brandId, menuId: id });
  }

  /**
   * Contract v4 Canonical Menu Update (§14)
   */
  static updateMenu({
    brandId,
    menuId,
    categoryId,
    titleId,
    rasaId = undefined,
    spiceEnabled = undefined,
    spiceLevel = undefined,
    sellingPrice,
    costPrice = undefined,
    items,
    status = undefined
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const current = repository.findMenu({ brandId, menuId });
    if (!current) throw new Error('MENU_NOT_FOUND');

    const nextCategoryId = categoryId === undefined ? current.category_id : categoryId;
    if (!nextCategoryId) throw new Error('CATEGORY_REQUIRED');
    const category = repository.findCategory({ brandId, categoryId: nextCategoryId });
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    if (category.is_active === 0 && String(category.id) !== String(current.category_id)) {
      throw new Error('CATEGORY_INACTIVE');
    }

    const nextTitleId = titleId === undefined ? current.title_id : titleId;
    if (!nextTitleId) throw new Error('TITLE_REQUIRED');
    const title = ComposedMenuService.findMenuTitle({ brandId, titleId: nextTitleId });
    if (!title) throw new Error('TITLE_NOT_FOUND');
    if (title.is_active === 0 && String(title.id) !== String(current.title_id)) {
      throw new Error('TITLE_INACTIVE');
    }

    const nextRasaId = rasaId === undefined ? current.rasa_id : (normalizeRasaId(rasaId) || null);
    let resolvedRasa = null;
    if (nextRasaId) {
      resolvedRasa = repository.findRasa({ brandId, rasaId: nextRasaId });
      if (!resolvedRasa) throw new Error('RASA_NOT_FOUND');
      if (resolvedRasa.is_active === 0 && String(resolvedRasa.id) !== String(current.rasa_id)) {
        throw new Error('RASA_INACTIVE');
      }
    }

    const nextPrice = sellingPrice === undefined ? Number(current.selling_price) : normalizePrice(sellingPrice);
    const nextCost = costPrice === undefined ? Number(current.cost_price || 0) : normalizePrice(costPrice);
    const nextSpice = spiceEnabled === undefined
      ? { enabled: Number(current.spice_enabled) === 1 ? 1 : 0, level: current.spice_level }
      : normalizeSpice(spiceEnabled, spiceLevel);
    const nextStatus = status === undefined ? current.status : normalizeStatus(status);

    const currentItems = repository.listMenuItems({ brandId, menuIds: [menuId] });
    const normalizedItems = items === undefined
      ? currentItems.map(item => ({ productId: item.product_id, quantity: Number(item.quantity) }))
      : ComposedMenuService.normalizeMenuItems(items);

    for (const item of normalizedItems) {
      const product = repository.findProduct({ brandId, productId: item.productId });
      if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');
      if (product.is_active === 0 && nextStatus !== 'DRAFT') {
        throw new Error('MASTER_PRODUCT_INACTIVE');
      }
    }

    repository.begin();
    try {
      repository.updateMenu({
        brandId,
        menuId,
        fields: {
          category_id: category.id,
          title_id: title.id,
          rasa_id: resolvedRasa ? resolvedRasa.id : null,
          selling_price: nextPrice,
          cost_price: nextCost,
          spice_enabled: nextSpice.enabled,
          spice_level: nextSpice.level,
          status: nextStatus
        }
      });

      repository.replaceMenuItems({ menuId, items: normalizedItems });
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      throw err;
    }

    return repository.findMenu({ brandId, menuId });
  }

  static setMenuStatus({
    brandId, menuId, status
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    const nextStatus = normalizeStatus(status);

    if (nextStatus === 'ACTIVE') {
      const items = repository.listMenuItems({ brandId, menuIds: [menuId] });
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('MENU_COMPOSITION_INVALID');
      }

      if (items.some(item => item.product_is_active === 0)) {
        throw new Error('MASTER_PRODUCT_INACTIVE');
      }

      if (!menu.category_id) throw new Error('CATEGORY_REQUIRED');
      if (!menu.title_id) throw new Error('TITLE_REQUIRED');
    }

    repository.db.execute(
      "UPDATE menus SET status = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [nextStatus, menuId, brandId]
    );
    return repository.findMenu({ brandId, menuId });
  }

  static deleteMenu({ brandId, menuId }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    repository.deleteMenu({ brandId, menuId });
    return { id: menuId, status: 'DELETED', deleted: true, menu };
  }

  static adoptMenuToBranch({
    brandId,
    branchId,
    menuId,
    isAvailable = true,
    priceOverride = null,
    branchCategoryIds = []
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');
    if (String(menu.status || '').toUpperCase() !== 'ACTIVE') {
      throw new Error('MENU_INACTIVE');
    }

    const branch = repository.db.queryOne(
      'SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?',
      [branchId, brandId]
    );
    if (!branch) throw new Error('BRANCH_NOT_FOUND');
    if (branch.is_active === 0) throw new Error('BRANCH_INACTIVE');

    const items = repository.listMenuItems({ brandId, menuIds: [menuId] });
    if (!items.length) throw new Error('MENU_COMPOSITION_INVALID');
    if (items.some(item => item.product_is_active === 0)) {
      throw new Error('MENU_COMPONENT_UNAVAILABLE');
    }

    const normalizedCategoryIds = Array.from(new Set(
      (Array.isArray(branchCategoryIds) ? branchCategoryIds : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    ));
    if (!normalizedCategoryIds.length) throw new Error('BRANCH_CATEGORY_REQUIRED');

    const categoryPlaceholders = normalizedCategoryIds.map(() => '?').join(', ');
    const categoryRows = repository.db.queryMany(
      'SELECT id, is_active FROM branch_categories WHERE brand_id = ? AND branch_id = ? AND id IN (' + categoryPlaceholders + ')',
      [brandId, branchId, ...normalizedCategoryIds]
    );
    if (categoryRows.length !== normalizedCategoryIds.length) {
      throw new Error('BRANCH_CATEGORY_NOT_FOUND');
    }
    if (categoryRows.some(row => row.is_active === 0)) {
      throw new Error('BRANCH_CATEGORY_INACTIVE');
    }

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
        branchCategoryIds: normalizedCategoryIds
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

  static setBranchMenuDisplayName({
    brandId, branchId, menuId, name, displayName: aliasDisplayName
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');
    const branch = repository.db.queryOne(
      'SELECT id FROM branches WHERE id = ? AND brand_id = ?',
      [branchId, brandId]
    );
    if (!branch) throw new Error('BRANCH_NOT_FOUND');

    const rawName = name !== undefined ? name : aliasDisplayName;
    const displayName = rawName == null ? null : String(rawName).trim() || null;
    if (displayName && displayName.length > 100) throw new Error('DISPLAY_NAME_TOO_LONG');

    repository.setBranchMenuDisplayName({
      brandId,
      branchId,
      menuId,
      displayNameOverride: displayName
    });

    return repository.findBranchMenu({ brandId, branchId, menuId });
  }

  static removeMenuFromBranch({
    brandId, branchId, menuId
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');
    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');
    repository.removeBranchMenu({ brandId, branchId, menuId });
    return { branch_id: branchId, menu_id: menuId, removed: true };
  }

  static setBranchMenuAvailability({
    brandId, branchId, menuId, isAvailable
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    const normalized = Boolean(isAvailable);
    repository.setBranchMenuAvailability({
      brandId,
      branchId,
      menuId,
      isAvailable: normalized
    });

    return repository.findBranchMenu({ brandId, branchId, menuId });
  }

  static listMenuTitles({ brandId, activeOnly = false }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.db.queryMany(
      'SELECT id, brand_id, name, slug, sort_order, is_active, created_at, updated_at ' +
      'FROM menu_titles WHERE brand_id = ?' + (activeOnly ? ' AND is_active = 1' : '') +
      ' ORDER BY sort_order ASC, name ASC',
      [brandId]
    );
  }

  static findMenuTitle({ brandId, titleId }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.db.queryOne(
      'SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_titles WHERE id = ? AND brand_id = ?',
      [titleId, brandId]
    );
  }

  static findMenuTitleByName({ brandId, name }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.db.queryOne(
      'SELECT id, brand_id, name, slug, sort_order, is_active FROM menu_titles ' +
      'WHERE brand_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1',
      [brandId, String(name == null ? '' : name)]
    );
  }

  static createMenuTitle({ brandId, name, slug = null, sortOrder = 0 }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedTitle = normalizeName(name, 'TITLE_NAME_REQUIRED');

    const existing = ComposedMenuService.findMenuTitleByName({ brandId, name: normalizedTitle });
    if (existing) {
      // Dipakai juga oleh pemilih [+] di editor Menu: nama yang sudah ada cukup dikembalikan.
      return existing;
    }

    const id = makeId('title');
    const nextSlug = slugify(slug || normalizedTitle);
    if (!nextSlug) throw new Error('TITLE_SLUG_REQUIRED');

    repository.db.execute(
      'INSERT INTO menu_titles (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [id, brandId, normalizedTitle, nextSlug, Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0]
    );

    return ComposedMenuService.findMenuTitle({ brandId, titleId: id });
  }

  static updateMenuTitle({
    brandId,
    titleId,
    name = undefined,
    slug = undefined,
    sortOrder = undefined,
    isActive = undefined
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = ComposedMenuService.findMenuTitle({ brandId, titleId });
    if (!current) throw new Error('TITLE_NOT_FOUND');

    const nextName = name === undefined ? current.name : normalizeName(name, 'TITLE_NAME_REQUIRED');
    const duplicate = ComposedMenuService.findMenuTitleByName({ brandId, name: nextName });
    if (duplicate && String(duplicate.id) !== String(titleId)) throw new Error('TITLE_ALREADY_EXISTS');

    const nextSlug = slug === undefined ? current.slug : slugify(slug || nextName);
    if (!nextSlug) throw new Error('TITLE_SLUG_REQUIRED');

    const nextSortOrder = sortOrder === undefined ? Number(current.sort_order || 0) : (
      Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0
    );
    const nextIsActive = isActive === undefined ? Number(current.is_active) : (Boolean(isActive) ? 1 : 0);

    repository.db.execute(
      "UPDATE menu_titles SET name = ?, slug = ?, sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [nextName, nextSlug, nextSortOrder, nextIsActive, titleId, brandId]
    );

    return ComposedMenuService.findMenuTitle({ brandId, titleId });
  }

  static countMenusUsingTitle({ brandId, titleId }) {
    ensureSchema();
    const row = repository.db.queryOne(
      'SELECT COUNT(*) AS total FROM menus WHERE brand_id = ? AND title_id = ?',
      [brandId, titleId]
    );
    return Number(row && row.total || 0);
  }

  /**
   * Hapus Judul. Permanen bila tidak ada Menu yang memakainya (FK-consistent).
   * Selama masih dipakai, penghapusan ditolak supaya referensi Menu tidak putus —
   * merchant diarahkan memakai toggle aktif/nonaktif.
   */
  static deleteMenuTitle({ brandId, titleId }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = ComposedMenuService.findMenuTitle({ brandId, titleId });
    if (!current) throw new Error('TITLE_NOT_FOUND');

    const usedBy = ComposedMenuService.countMenusUsingTitle({ brandId, titleId });
    if (usedBy > 0) {
      const err = new Error('TITLE_IN_USE_BY_MENUS');
      err.status = 409;
      err.details = { used_by_menu_count: usedBy };
      throw err;
    }

    repository.db.execute('DELETE FROM menu_titles WHERE id = ? AND brand_id = ?', [titleId, brandId]);

    return { id: titleId, status: 'DELETED', deleted: true, used_by_menu_count: 0, title: current };
  }

  static updateRasa({
    brandId,
    rasaId,
    name = undefined,
    slug = undefined,
    sortOrder = undefined,
    isActive = undefined
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = repository.findRasa({ brandId, rasaId });
    if (!current) throw new Error('RASA_NOT_FOUND');

    const currentIsOriginal = String(current.name || '').trim().toLowerCase() === 'original';
    const nextName = name === undefined ? current.name : normalizeName(name, 'RASA_NAME_REQUIRED');
    const nextIsOriginal = String(nextName || '').trim().toLowerCase() === 'original';
    if (currentIsOriginal && !nextIsOriginal) throw new Error('RASA_ORIGINAL_PROTECTED');
    if (nextIsOriginal && !currentIsOriginal) throw new Error('RASA_ORIGINAL_PROTECTED');

    const duplicate = repository.findRasaByName({ brandId, name: nextName });
    if (duplicate && String(duplicate.id) !== String(rasaId)) throw new Error('RASA_ALREADY_EXISTS');

    const nextSlug = slug === undefined ? current.slug : slugify(slug || nextName);
    if (!nextSlug) throw new Error('RASA_SLUG_REQUIRED');

    const nextSortOrder = sortOrder === undefined ? Number(current.sort_order || 0) : (
      Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0
    );
    const nextIsActive = isActive === undefined ? Number(current.is_active) : (Boolean(isActive) ? 1 : 0);
    if (currentIsOriginal && nextIsActive === 0) throw new Error('RASA_ORIGINAL_PROTECTED');

    repository.db.execute(
      "UPDATE menu_flavors SET name = ?, slug = ?, sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [nextName, nextSlug, nextSortOrder, nextIsActive, rasaId, brandId]
    );

    return repository.findRasa({ brandId, rasaId });
  }

  static deleteRasa({ brandId, rasaId }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = repository.findRasa({ brandId, rasaId });
    if (!current) throw new Error('RASA_NOT_FOUND');
    if (String(current.name || '').trim().toLowerCase() === 'original') {
      throw new Error('RASA_ORIGINAL_PROTECTED');
    }

    repository.db.execute(
      "UPDATE menu_flavors SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
      [rasaId, brandId]
    );

    return {
      id: rasaId,
      status: 'ARCHIVED',
      archived: true,
      rasa: repository.findRasa({ brandId, rasaId })
    };
  }
  static listMenus({
    brandId, menuType = null, status = null
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const menus = repository.listMenus({
      brandId,
      menuType,
      status: status ? normalizeStatus(status) : null
    });
    if (!menus.length) return [];
    const menuIds = menus.map(m => m.id);
    const items = repository.listMenuItems({ brandId, menuIds });
    const itemMap = new Map();
    items.forEach(it => {
      const k = String(it.menu_id);
      if (!itemMap.has(k)) itemMap.set(k, []);
      itemMap.get(k).push({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: Number(it.quantity || 1)
      });
    });
    return menus.map(m => ({
      ...m,
      components: itemMap.get(String(m.id)) || []
    }));
  }
}

module.exports = ComposedMenuService;
