'use strict';

const crypto = require('crypto');
const ComposedMenuRepository = require('../repositories/ComposedMenuRepository');

const repository = new ComposedMenuRepository();

function ensureSchema() {
  repository.ensureSchema();
}

function makeId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '');
}

function normalizeName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw new Error('PRODUCT_NAME_REQUIRED');
  if (name.length > 255) throw new Error('PRODUCT_NAME_TOO_LONG');
  return name;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function normalizeSku(value) {
  if (value == null) return null;
  const sku = String(value).trim();
  return sku || null;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new Error('INVALID_BOOLEAN');
}

class ComposedProductService {
  static createProduct({
    brandId,
    name,
    sku = null,
    description = '',
    imageUrl = null,
    image = null,
    isActive = true,
    actorId = null,
    actorRole = null
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const normalizedName = normalizeName(name);
    const normalizedSku = normalizeSku(sku);
    const id = makeId('prd');
    const baseSlug = slugify(normalizedName) || id;
    const slug = baseSlug + '-' + id.slice(-8);

    repository.db.exec('BEGIN IMMEDIATE');
    try {
      repository.db.execute(
        "INSERT INTO products " +
        "(id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, is_active, sku) " +
        "VALUES (?, ?, NULL, ?, ?, ?, 0, NULL, ?, ?, ?, ?)",
        [id, brandId, normalizedName, slug, description == null ? '' : String(description), imageUrl, image, normalizeBoolean(isActive) ? 1 : 0, normalizedSku]
      );

      if (normalizedSku) {
        repository.db.execute(
          "INSERT INTO product_sku_history " +
          "(id, brand_id, product_id, previous_sku, new_sku, actor_id, actor_role) " +
          "VALUES (?, ?, ?, NULL, ?, ?, ?)",
          [makeId('skuhist'), brandId, id, normalizedSku, actorId, actorRole]
        );

        // SKU is the stockability boundary: make the Product visible in
        // canonical branch inventory for every currently active branch.
        repository.ensureSkuProductInventoryForActiveBranches({
          brandId,
          productId: id
        });
      }

      repository.db.exec('COMMIT');
    } catch (err) {
      try { repository.db.exec('ROLLBACK'); } catch (_) {}
      if (/idx_products_brand_sku_normalized/i.test(String(err && err.message))) {
        throw new Error('PRODUCT_SKU_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findProduct({ brandId, productId: id });
  }

  static updateProduct({
    brandId,
    productId,
    name,
    description,
    imageUrl,
    image,
    isActive,
    sku,
    actorId = null,
    actorRole = null
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = repository.findProduct({ brandId, productId });
    if (!current) throw new Error('MASTER_PRODUCT_NOT_FOUND');

    const previousSku = current.sku == null ? null : String(current.sku).trim() || null;
    const nextSku = sku === undefined ? previousSku : normalizeSku(sku);
    if (previousSku !== nextSku && previousSku && !nextSku) {
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

    const normalizedName = name === undefined ? null : normalizeName(name);
    const nextDescription = description === undefined ? null : (description == null ? '' : String(description));
    const nextImageUrl = imageUrl === undefined ? null : imageUrl;
    const nextImage = image === undefined ? null : image;
    const nextActive = isActive === undefined ? null : (normalizeBoolean(isActive) ? 1 : 0);

    repository.db.exec('BEGIN IMMEDIATE');
    try {
      if (normalizedName !== null) {
        repository.db.execute(
          "UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
          [normalizedName, productId, brandId]
        );
      }
      if (description !== undefined) {
        repository.db.execute(
          "UPDATE products SET description = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
          [nextDescription, productId, brandId]
        );
      }
      if (imageUrl !== undefined || image !== undefined) {
        repository.db.execute(
          "UPDATE products SET image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
          [imageUrl === undefined ? current.image_url : nextImageUrl, image === undefined ? current.image : nextImage, productId, brandId]
        );
      }
      if (nextActive !== null) {
        repository.db.execute(
          "UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
          [nextActive, productId, brandId]
        );
      }

      if (previousSku !== nextSku) {
        try {
          repository.db.execute(
            "UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
            [nextSku, productId, brandId]
          );
        } catch (err) {
          if (/idx_products_brand_sku_normalized/i.test(String(err && err.message))) {
            throw new Error('PRODUCT_SKU_ALREADY_EXISTS');
          }
          if (/PRODUCT_SKU_EMPTY/i.test(String(err && err.message))) {
            throw new Error('PRODUCT_SKU_EMPTY');
          }
          throw err;
        }

        repository.db.execute(
          "INSERT INTO product_sku_history " +
          "(id, brand_id, product_id, previous_sku, new_sku, actor_id, actor_role) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
          [makeId('skuhist'), brandId, productId, previousSku, nextSku, actorId, actorRole]
        );
      }

      repository.db.exec('COMMIT');
    } catch (err) {
      try { repository.db.exec('ROLLBACK'); } catch (_) {}
      if (/idx_products_brand_sku_normalized/i.test(String(err && err.message))) {
        throw new Error('PRODUCT_SKU_ALREADY_EXISTS');
      }
      throw err;
    }

    return repository.findProduct({ brandId, productId });
  }

  static archiveProduct({ brandId, productId, actorId = null, actorRole = null }) {
    return this.updateProduct({
      brandId,
      productId,
      isActive: false,
      actorId,
      actorRole
    });
  }

  static listProducts({ brandId, activeOnly = true, query = null }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listProducts({ brandId, activeOnly, query });
  }
}

module.exports = ComposedProductService;
