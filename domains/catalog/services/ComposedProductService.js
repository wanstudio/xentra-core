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
    isActive = true
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const normalizedName = normalizeName(name);
    const normalizedSku = normalizeSku(sku);
    const id = makeId('prd');
    const baseSlug = slugify(normalizedName) || id;
    const slug = baseSlug + '-' + id.slice(-8);

    try {
      repository.db.execute(
        "INSERT INTO products " +
        "(id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, is_active) " +
        "VALUES (?, ?, NULL, ?, ?, ?, 0, NULL, ?, ?, ?)",
        [id, brandId, normalizedName, slug, description == null ? '' : String(description), imageUrl, image, normalizeBoolean(isActive) ? 1 : 0]
      );

      if (normalizedSku) {
        repository.db.execute(
          "UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
          [normalizedSku, id, brandId]
        );
      }
    } catch (err) {
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
    sku
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const current = repository.findProduct({ brandId, productId });
    if (!current) throw new Error('MASTER_PRODUCT_NOT_FOUND');

    if (name !== undefined) {
      const normalizedName = normalizeName(name);
      repository.db.execute(
        "UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
        [normalizedName, productId, brandId]
      );
    }
    if (description !== undefined) {
      repository.db.execute(
        "UPDATE products SET description = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
        [description == null ? '' : String(description), productId, brandId]
      );
    }
    if (imageUrl !== undefined || image !== undefined) {
      repository.db.execute(
        "UPDATE products SET image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
        [imageUrl === undefined ? current.image_url : imageUrl, image === undefined ? current.image : image, productId, brandId]
      );
    }
    if (isActive !== undefined) {
      repository.db.execute(
        "UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?",
        [normalizeBoolean(isActive) ? 1 : 0, productId, brandId]
      );
    }
    if (sku !== undefined) {
      const ComposedMenuService = require('./ComposedMenuService');
      ComposedMenuService.setProductSku({
        brandId,
        productId,
        sku
      });
    }

    return repository.findProduct({ brandId, productId });
  }

  static archiveProduct({ brandId, productId, actorId = null, actorRole = null }) {
    ensureSchema();
    return this.updateProduct({
      brandId,
      productId,
      isActive: false,
      sku: undefined,
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
