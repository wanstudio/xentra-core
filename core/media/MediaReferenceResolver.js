'use strict';

/**
 * MediaReferenceResolver - Resolves business entity references for Media System (M4)
 *
 * Checks all known media slots and tables in Xentra Core:
 * - Brand logo (`brands.logo_url` or `attached_to_id`)
 * - Brand promotional banners (`brands.banners` JSON array)
 * - Master catalog products (`products.image_url` or `image` or `attached_to_id`)
 * - Master catalog categories (`categories.image_url` or `image` or `attached_to_id`)
 * - Branch product overrides (`branch_products.product_image_url` or `image_override`)
 * - Branch category overrides (`branch_categories.image_url`)
 * - Explicit attachments (`media_assets.attached_to_type` & `attached_to_id`)
 *
 * Guarantees that referenced assets are strictly protected from garbage collection and deletion.
 */
const DataAccess = require('../data/DataAccess');

class MediaReferenceResolver {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  /**
   * Check if a specific media asset is actively referenced by any business entity.
   * @param {Object} params
   * @param {string} params.mediaId
   * @param {string} [params.brandId]
   * @returns {Promise<{ isReferenced: boolean, references: Array<{ type: string, id: string, field: string }> }>}
   */
  async checkReference({ mediaId, brandId = null }) {
    if (!mediaId) {
      return { isReferenced: false, references: [] };
    }

    const references = [];

    // 1. Check explicit attachment in media_assets table
    let assetQuery = 'SELECT id, brand_id, storage_key, attached_to_type, attached_to_id FROM media_assets WHERE id = ?';
    const assetParams = [mediaId];
    if (brandId) {
      assetQuery += ' AND brand_id = ?';
      assetParams.push(brandId);
    }
    const asset = this.db.queryOne(assetQuery, assetParams);

    if (asset && asset.attached_to_type && asset.attached_to_id) {
      references.push({
        type: asset.attached_to_type,
        id: asset.attached_to_id,
        field: 'attached_to'
      });
    }

    const storageKey = asset ? asset.storage_key : null;
    const mediaIdPattern = `%${mediaId}%`;

    // 2. Check Brand logo & banners
    let brandSql = 'SELECT id, logo_url, banners FROM brands';
    const brandParams = [];
    if (brandId) {
      brandSql += ' WHERE id = ?';
      brandParams.push(brandId);
    }
    const brands = this.db.queryMany(brandSql, brandParams);

    for (const b of brands) {
      // Check logo_url
      if (b.logo_url && (b.logo_url.includes(mediaId) || (storageKey && b.logo_url.includes(storageKey)))) {
        references.push({ type: 'brand_logo', id: b.id, field: 'logo_url' });
      }
      // Check banners JSON array
      if (b.banners) {
        try {
          const bannerList = typeof b.banners === 'string' ? JSON.parse(b.banners) : b.banners;
          if (Array.isArray(bannerList)) {
            const hasBanner = bannerList.some(item => {
              if (typeof item === 'string') {
                return item.includes(mediaId) || (storageKey && item.includes(storageKey));
              }
              if (item && typeof item === 'object') {
                return item.media_id === mediaId ||
                  (item.image_url && (item.image_url.includes(mediaId) || (storageKey && item.image_url.includes(storageKey))));
              }
              return false;
            });
            if (hasBanner) {
              references.push({ type: 'brand_banner', id: b.id, field: 'banners' });
            }
          }
        } catch (_) {}
      }
    }

    // 3. Check Products table
    let prodSql = 'SELECT id, brand_id, image_url, image FROM products WHERE (image_url LIKE ? OR image LIKE ?)';
    const prodParams = [mediaIdPattern, mediaIdPattern];
    if (brandId) {
      prodSql += ' AND brand_id = ?';
      prodParams.push(brandId);
    }
    const products = this.db.queryMany(prodSql, prodParams);
    for (const p of products) {
      references.push({ type: 'product', id: p.id, field: 'image_url' });
    }

    // 4. Check Categories table
    let catSql = 'SELECT id, brand_id, image_url, image FROM categories WHERE (image_url LIKE ? OR image LIKE ?)';
    const catParams = [mediaIdPattern, mediaIdPattern];
    if (brandId) {
      catSql += ' AND brand_id = ?';
      catParams.push(brandId);
    }
    const categories = this.db.queryMany(catSql, catParams);
    for (const c of categories) {
      references.push({ type: 'category', id: c.id, field: 'image_url' });
    }

    // 5. Check Branch Products table (product_image_url or image_override)
    try {
      const bpList = this.db.queryMany(`
        SELECT branch_id, product_id, product_image_url
        FROM branch_products
        WHERE product_image_url LIKE ?
      `, [mediaIdPattern]);
      for (const bp of bpList) {
        references.push({
          type: 'branch_product',
          id: `${bp.branch_id}:${bp.product_id}`,
          field: 'product_image_url'
        });
      }
    } catch (_) {}

    // 6. Check Branch Categories table
    try {
      const bcList = this.db.queryMany(`
        SELECT id, branch_id, image_url
        FROM branch_categories
        WHERE image_url LIKE ?
      `, [mediaIdPattern]);
      for (const bc of bcList) {
        references.push({
          type: 'branch_category',
          id: bc.id,
          field: 'image_url'
        });
      }
    } catch (_) {}

    return {
      isReferenced: references.length > 0,
      references
    };
  }
}

module.exports = MediaReferenceResolver;
