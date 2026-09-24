/**
 * XENTRA CORE — ADMIN ENTITY MEDIA ROUTES
 *
 * Canonical image pipeline for brand/product/category/banner/branch entities.
 */
'use strict';

module.exports = function registerMediaEntityRoutes(router, deps) {
  const {
    db,
    requireAuth,
    mediaService,
    coreBrandRepo
  } = deps;

/**
 * Helper: resolve the best derivative URL for dashboard preview.
 * Returns the smallest variant that is >= minWidth, or the largest available.
 */
function resolvePreviewUrl(asset, minWidth = 320) {
  if (!asset || !Array.isArray(asset.variants) || asset.variants.length === 0) {
    return asset ? asset.url : null;
  }
  const sorted = [...asset.variants].sort((a, b) => a.width - b.width);
  const candidate = sorted.find(v => v.width >= minWidth) || sorted[sorted.length - 1];
  return candidate ? candidate.url : asset.url;
}


/**
 * Helper: run the full canonical pipeline for a single entity image upload.
 *   stageUpload → setCropSpec (optional) → processMedia → return asset + previewUrl
 * On processing failure, the staged asset is left in FAILED state (never published).
 */
async function runEntityMediaPipeline({ brandId, tenantId, userId, imageBase64, mimeType,
  originalFilename, assetType, cropSpec }) {
  // Stage
  const staged = await mediaService.stageUpload({
    brandId,
    tenantId,
    userId,
    imageBase64,
    mimeType,
    declaredFilename: originalFilename,
    assetType,
    enforceAspectRatio: false  // Source may be any ratio; crop fixes it
  });

  // Persist crop spec if provided (M2)
  if (cropSpec && typeof cropSpec === 'object') {
    await mediaService.setCropSpec({ mediaId: staged.media_id, brandId, cropSpec });
  }

  // Process (M3 — crop → resize → WebP derivatives)
  const processed = await mediaService.processMedia({
    mediaId: staged.media_id,
    brandId,
    cropSpec: cropSpec || null
  });

  return processed;
}

// ---- Brand Logo (M5 canonical) ----

/**
 * POST /admin/media/entity/brand/logo
 * Upload, process, and attach a canonical logo to the current brand.
 * Body: { image_base64, mime_type, original_filename, crop_spec? }
 * Response includes asset with derivatives and preview_url.
 */
router.post('/admin/media/entity/brand/logo',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar logo wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      // Fetch current logo_media_id for replacement semantics
      const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
      const oldMediaId = brand ? brand.logo_media_id : null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'logo',
        cropSpec: crop_spec || null
      });

      // Attach to entity
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'brand_logo',
        entityId: req.brand_id
      });

      // Atomic replacement: if old logo media exists, orphan it
      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.replaceEntityMedia({
          newMediaId: asset.media_id,
          oldMediaId,
          brandId: req.brand_id,
          entityType: 'brand_logo',
          entityId: req.brand_id
        }).catch(() => {}); // Non-fatal — attachment already done above
      }

      // Resolve preview URL (prefer smallest derivative for logo thumbnail)
      const previewUrl = resolvePreviewUrl(asset, 320);

      // Sync brand table: logo_media_id + logo_url (derivative) for legacy consumers
      coreBrandRepo.updateBrandLogoMedia(req.brand_id, {
        mediaId: asset.media_id,
        logoUrl: previewUrl || asset.url
      });

      if (req.brand) req.brand.logo_url = previewUrl || asset.url;

      res.status(201).json({
        success: true,
        message: 'Logo brand berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        logo_url: previewUrl || asset.url
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/brand/logo]:', err.message);
      res.status(statusCode).json({
        success: false,
        error: err.message,
        code: err.code || 'LOGO_UPLOAD_ERROR'
      });
    }
  }
);

/**
 * DELETE /admin/media/entity/brand/logo
 * Remove brand logo using canonical lifecycle (soft-orphan).
 */
router.delete('/admin/media/entity/brand/logo',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
      const mediaId = brand ? brand.logo_media_id : null;

      if (mediaId) {
        await mediaService.unlinkMedia({ mediaId, brandId: req.brand_id }).catch(() => {});
      }

      coreBrandRepo.removeBrandLogoMedia(req.brand_id);
      if (req.brand) req.brand.logo_url = null;

      res.json({ success: true, message: 'Logo brand berhasil dihapus.', logo_url: null });
    } catch (err) {
      console.error('[M5 DELETE /admin/media/entity/brand/logo]:', err.message);
      res.status(500).json({ success: false, error: err.message, code: 'LOGO_DELETE_ERROR' });
    }
  }
);

// ---- Master Product Image (M5 canonical) ----

/**
 * POST /admin/media/entity/products/:productId/image
 * Upload, process, and attach canonical media to a master product.
 * Body: { image_base64, mime_type, original_filename?, crop_spec? }
 */
router.post('/admin/media/entity/products/:productId/image',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const product = db.prepare('SELECT id, media_id FROM products WHERE id = ? AND brand_id = ?')
        .get(req.params.productId, req.brand_id);
      if (!product) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan.', code: 'PRODUCT_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar produk wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = product.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'product',
        cropSpec: crop_spec || null
      });

      // Attach to entity
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'product',
        entityId: String(req.params.productId)
      });

      // Orphan old asset if different
      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      // Update product: canonical media_id + legacy image_url sync
      db.prepare("UPDATE products SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?")
        .run(asset.media_id, previewUrl || asset.url, previewUrl || asset.url, req.params.productId, req.brand_id);

      res.status(201).json({
        success: true,
        message: 'Gambar produk berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        product: {
          id: req.params.productId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'PRODUCT_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/products/:productId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'PRODUCT_IMAGE_UPLOAD_ERROR' });
    }
  }
);

// ---- Master Category Image (M5 canonical) ----

/**
 * POST /admin/media/entity/categories/:categoryId/image
 * Upload, process, and attach canonical media to a master category.
 */
router.post('/admin/media/entity/categories/:categoryId/image',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const category = db.prepare('SELECT id, media_id FROM categories WHERE id = ? AND brand_id = ?')
        .get(req.params.categoryId, req.brand_id);
      if (!category) return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.', code: 'CATEGORY_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar kategori wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = category.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'category',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'category',
        entityId: String(req.params.categoryId)
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      db.prepare("UPDATE categories SET media_id = ?, image_url = ?, image = ? WHERE id = ? AND brand_id = ?")
        .run(asset.media_id, previewUrl || asset.url, previewUrl || asset.url, req.params.categoryId, req.brand_id);

      res.status(201).json({
        success: true,
        message: 'Gambar kategori berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        category: {
          id: req.params.categoryId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'CATEGORY_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/categories/:categoryId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'CATEGORY_IMAGE_UPLOAD_ERROR' });
    }
  }
);

// ---- Promo Banner (M5 canonical) ----

/**
 * POST /admin/media/entity/banners
 * Upload, process (banner 1.94:1 ratio), and add as canonical banner entry.
 * Body: { image_base64, mime_type, title?, link?, crop_spec? }
 */
router.post('/admin/media/entity/banners',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      let banners = [];
      try {
        banners = req.brand && req.brand.banners
          ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners)
          : [];
      } catch (_) {}
      if (!Array.isArray(banners)) banners = [];

      if (banners.length >= 5) {
        return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.', code: 'BANNER_LIMIT_EXCEEDED' });
      }

      const { image_base64, mime_type, original_filename, title = '', link = '#', crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar banner wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'banner',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'brand_banner',
        entityId: req.brand_id
      });

      const previewUrl = resolvePreviewUrl(asset, 640);

      const newBanner = {
        id: 'banner_' + Date.now(),
        media_id: asset.media_id,
        image_url: previewUrl || asset.url,
        title,
        link
      };
      banners.push(newBanner);
      const bannersJson = JSON.stringify(banners);
      db.prepare("UPDATE brands SET banners = ?, updated_at = datetime('now') WHERE id = ?").run(bannersJson, req.brand_id);
      if (req.brand) req.brand.banners = bannersJson;

      res.status(201).json({
        success: true,
        message: 'Banner promo berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        banner: newBanner,
        banners
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/banners]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BANNER_UPLOAD_ERROR' });
    }
  }
);

// ---- Branch Category Image (M5 canonical) ----

/**
 * POST /admin/media/entity/branches/:branchId/categories/:catId/image
 * Upload, process, and attach canonical media to a branch category.
 * Respects branch_manager scope restriction.
 */
router.post('/admin/media/entity/branches/:branchId/categories/:catId/image',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  async (req, res) => {
    try {
      // Branch scope enforcement
      if (req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== req.params.branchId) {
          return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', code: 'FORBIDDEN_BRANCH_SCOPE' });
        }
      }

      const cat = db.prepare('SELECT id, media_id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
        .get(req.params.catId, req.params.branchId, req.brand_id);
      if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.', code: 'CATEGORY_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar kategori cabang wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = cat.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'category',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'branch_category',
        entityId: String(req.params.catId)
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      try {
        db.prepare("UPDATE branch_categories SET media_id = ?, image_url = ?, updated_at = datetime('now') WHERE id = ? AND branch_id = ?")
          .run(asset.media_id, previewUrl || asset.url, req.params.catId, req.params.branchId);
      } catch (e) {
        if (String(e).includes('no such column: media_id')) {
          db.prepare("UPDATE branch_categories SET image_url = ?, updated_at = datetime('now') WHERE id = ? AND branch_id = ?")
            .run(previewUrl || asset.url, req.params.catId, req.params.branchId);
        } else throw e;
      }

      res.status(201).json({
        success: true,
        message: 'Gambar kategori cabang berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        category: { id: req.params.catId, media_id: asset.media_id, image_url: previewUrl || asset.url }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'CATEGORY_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/branches/:branchId/categories/:catId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BRANCH_CAT_IMAGE_ERROR' });
    }
  }
);

// ---- Branch Product Image Override (M5 canonical) ----

/**
 * POST /admin/media/entity/branches/:branchId/products/:productId/image
 * Upload, process, and attach canonical media as branch product image override.
 */
router.post('/admin/media/entity/branches/:branchId/products/:productId/image',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  async (req, res) => {
    try {
      if (req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== req.params.branchId) {
          return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', code: 'FORBIDDEN_BRANCH_SCOPE' });
        }
      }

      const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.branchId, req.brand_id);
      if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.', code: 'BRANCH_NOT_FOUND' });

      const bp = db.prepare('SELECT branch_id, image_media_id FROM branch_products WHERE branch_id = ? AND product_id = ?')
        .get(req.params.branchId, req.params.productId);
      if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.', code: 'BRANCH_PRODUCT_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar produk cabang wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = bp.image_media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'product',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'branch_product',
        entityId: `${req.params.branchId}:${req.params.productId}`
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      try {
        db.prepare("UPDATE branch_products SET image_media_id = ?, image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
          .run(asset.media_id, previewUrl || asset.url, req.params.branchId, req.params.productId);
      } catch (e) {
        if (String(e).includes('no such column: image_media_id')) {
          db.prepare("UPDATE branch_products SET image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
            .run(previewUrl || asset.url, req.params.branchId, req.params.productId);
        } else throw e;
      }

      res.status(201).json({
        success: true,
        message: 'Gambar produk cabang berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        product: {
          branch_id: req.params.branchId,
          product_id: req.params.productId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url,
          image_override: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/branches/:branchId/products/:productId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BRANCH_PRODUCT_IMAGE_ERROR' });
    }
  }
);

/**
 * GET /admin/media/entity/:entityType/:entityId
 * Fetch the current canonical media asset attached to an entity with derivative preview URLs.
 * entity_type: brand_logo | product | category | branch_category | branch_product | brand_banner
 */
router.get('/admin/media/entity/:entityType/:entityId',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      // Find the attached asset from media_assets
      const asset = db.prepare(
        "SELECT * FROM media_assets WHERE brand_id = ? AND attached_to_type = ? AND attached_to_id = ? AND status = 'ready' ORDER BY attached_at DESC LIMIT 1"
      ).get(req.brand_id, entityType, entityId);

      if (!asset) {
        return res.json({ success: true, asset: null, preview_url: null });
      }

      const formatted = mediaService.getMedia({ mediaId: asset.id, brandId: req.brand_id });
      const previewUrl = resolvePreviewUrl(formatted, 320);

      res.json({ success: true, asset: formatted, preview_url: previewUrl });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, code: 'ENTITY_MEDIA_FETCH_ERROR' });
    }
  }
);

};
