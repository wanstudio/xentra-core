/**
 * XENTRA CORE — MEDIA UPLOAD ROUTES
 *
 * Legacy/canonical image upload adapters for master products and branch
 * catalog entities. Validation and persistence behaviour are unchanged.
 */

module.exports = function registerMediaUploadRoutes(router, deps) {
  const {
    db,
    requireAuth,
    mediaService
  } = deps;

  // Upload / replace a branch category's image.
// Persisted to disk under /assets/uploads/categories and verified strictly via ImageValidator.
const CATEGORY_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/categories');
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/products');
const BRANCH_PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/branch-products');

router.post('/admin/branches/:id/categories/:catId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && String(assignedBranchId) !== String(req.params.id)) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id, media_id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.', code: 'CATEGORY_NOT_FOUND' });

    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar kategori cabang wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const staged = await mediaService.stageUpload({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      declaredFilename: original_filename || null,
      assetType: 'category',
      enforceAspectRatio: false
    });
    const asset = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: req.brand_id,
      cropSpec: crop_spec || null
    });

    const oldMediaId = cat.media_id || null;
    if (oldMediaId) {
      await mediaService.replaceEntityMedia({
        newMediaId: asset.media_id,
        oldMediaId,
        brandId: req.brand_id,
        entityType: 'branch_category',
        entityId: String(req.params.catId)
      });
    } else {
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'branch_category',
        entityId: String(req.params.catId)
      });
    }

    const preview = (asset.variants || []).slice().sort((a, b) => a.width - b.width).find(v => v.width >= 320) || (asset.variants || []).slice(-1)[0];
    const imageUrl = preview ? preview.url : asset.url;
    db.prepare("UPDATE branch_categories SET media_id = ?, image_url = ?, updated_at = datetime('now') WHERE id = ? AND branch_id = ?")
      .run(asset.media_id, imageUrl, req.params.catId, req.params.id);

    res.status(201).json({ success: true, category: { id: req.params.catId, image_url: imageUrl, media_id: asset.media_id }, asset, preview_url: imageUrl });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'CATEGORY_NOT_FOUND' ? 404 : 400);
    console.error('[API Error POST /admin/branches/:id/categories/:catId/image]:', err);
    res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BRANCH_CATEGORY_IMAGE_UPLOAD_ERROR' });
  }
});

// Upload / replace a master product (menu item) image.

router.post('/admin/products/:productId/image', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const product = db.prepare('SELECT id, media_id FROM products WHERE id = ? AND brand_id = ?')
      .get(req.params.productId, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.', code: 'PRODUCT_NOT_FOUND' });

    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar produk wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const staged = await mediaService.stageUpload({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      declaredFilename: original_filename || null,
      assetType: 'product',
      enforceAspectRatio: false
    });
    const asset = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: req.brand_id,
      cropSpec: crop_spec || null
    });

    const oldMediaId = product.media_id || null;
    if (oldMediaId) {
      await mediaService.replaceEntityMedia({
        newMediaId: asset.media_id,
        oldMediaId,
        brandId: req.brand_id,
        entityType: 'product',
        entityId: String(req.params.productId)
      });
    } else {
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'product',
        entityId: String(req.params.productId)
      });
    }

    const preview = (asset.variants || []).slice().sort((a, b) => a.width - b.width).find(v => v.width >= 320) || (asset.variants || []).slice(-1)[0];
    const imageUrl = preview ? preview.url : asset.url;
    db.prepare("UPDATE products SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?")
      .run(asset.media_id, imageUrl, imageUrl, req.params.productId, req.brand_id);

    res.status(201).json({
      success: true,
      product: { id: req.params.productId, image_url: imageUrl, image: imageUrl, media_id: asset.media_id },
      asset,
      preview_url: imageUrl
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'PRODUCT_NOT_FOUND' ? 404 : 400);
    console.error('[API Error POST /admin/products/:productId/image]:', err);
    res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'PRODUCT_IMAGE_UPLOAD_ERROR' });
  }
});

// LEGACY QUARANTINED (2026-09-29): Branch Product image override is disabled.
// The forward architecture uses Owner-owned Master Product media.
// Keep the endpoint only so older clients receive an explicit, deterministic response.
router.post('/admin/branches/:id/products/:productId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'LEGACY_BRANCH_PRODUCT_IMAGE_OVERRIDE_DISABLED',
    message: 'Foto Menu Cabang tidak dapat diubah. Foto Menu ditentukan oleh Master Product Owner.'
  });
});

// ============================================================================
// CANONICAL MEDIA SYSTEM (M1) - Upload Security, Staging, Lifecycle & Attach
// ============================================================================

// Stage an upload into TEMPORARY state with binary validation
router.post('/admin/media/upload', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, asset_type, enforce_aspect_ratio } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const asset = await mediaService.stageUpload({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      declaredFilename: original_filename,
      assetType: asset_type || 'general',
      enforceAspectRatio: Boolean(enforce_aspect_ratio)
    });

    res.status(201).json({
      success: true,
      message: 'Media berhasil diunggah ke staging.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'UPLOAD_ERROR',
      dimensions: err.dimensions
    });
  }
});

// Mark asset as READY (completing upload pipeline)
router.post('/admin/media/:id/ready', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const asset = await mediaService.markReady({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Media siap digunakan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'TRANSITION_ERROR'
    });
  }
});

// Update crop specification intent (M2)
router.post('/admin/media/:id/crop', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { crop_spec } = req.body || {};
    if (!crop_spec || typeof crop_spec !== 'object') {
      return res.status(400).json({ success: false, error: 'crop_spec object wajib disertakan.', code: 'MISSING_CROP_SPEC' });
    }

    const asset = await mediaService.setCropSpec({
      mediaId: req.params.id,
      brandId: req.brand_id,
      cropSpec: crop_spec
    });

    res.json({
      success: true,
      message: 'Spesifikasi crop berhasil disimpan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'CROP_SPEC_ERROR'
    });
  }
});

// Canonical M3 Server-Side Image Processing Pipeline
router.post('/admin/media/:id/process', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { crop_spec } = req.body || {};
    const asset = await mediaService.processMedia({
      mediaId: req.params.id,
      brandId: req.brand_id,
      cropSpec: crop_spec || null
    });

    res.json({
      success: true,
      message: 'Pemrosesan gambar kanonikal berhasil diselesaikan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'PROCESSING_ERROR',
      asset: err.asset || null
    });
  }
});


// Transition lifecycle status
router.post('/admin/media/:id/transition', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { target_status, error_message } = req.body || {};
    const asset = await mediaService.transitionStatus({
      mediaId: req.params.id,
      brandId: req.brand_id,
      targetStatus: target_status,
      errorMessage: error_message
    });
    res.json({
      success: true,
      message: `Status media berhasil diubah menjadi '${target_status}'.`,
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'TRANSITION_ERROR'
    });
  }
});

// Retry a failed asset
router.post('/admin/media/:id/retry', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const asset = await mediaService.retryFailed({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Aset media berhasil di-retry.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'RETRY_ERROR'
    });
  }
});

// Attach a READY asset to an entity
router.post('/admin/media/:id/attach', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body || {};
    if (!entity_type || !entity_id) {
      return res.status(400).json({ success: false, error: 'entity_type dan entity_id wajib disertakan.', code: 'MISSING_ATTACH_TARGET' });
    }

    const asset = await mediaService.attachToEntity({
      mediaId: req.params.id,
      brandId: req.brand_id,
      entityType: entity_type,
      entityId: String(entity_id)
    });

    res.json({
      success: true,
      message: 'Media berhasil dikaitkan ke entitas.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'ATTACH_ERROR'
    });
  }
});

// Atomic replacement of media
router.post('/admin/media/replace', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { new_media_id, old_media_id, entity_type, entity_id } = req.body || {};
    if (!new_media_id || !entity_type || !entity_id) {
      return res.status(400).json({
        success: false,
        error: 'new_media_id, entity_type, dan entity_id wajib disertakan.',
        code: 'MISSING_REPLACE_PARAMS'
      });
    }

    const asset = await mediaService.replaceEntityMedia({
      newMediaId: new_media_id,
      oldMediaId: old_media_id,
      brandId: req.brand_id,
      entityType: entity_type,
      entityId: String(entity_id)
    });

    res.json({
      success: true,
      message: 'Media berhasil diganti secara atomik.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'REPLACE_ERROR'
    });
  }
});

// Media storage consistency check (M4) — defined before parameterized /:id route
router.get('/admin/media/consistency', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const result = await mediaService.checkConsistency({
      brandId: req.brand_id
    });
    res.json({
      success: true,
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'CONSISTENCY_CHECK_ERROR'
    });
  }
});

// List media for current brand — defined before parameterized /:id route
router.get('/admin/media', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { status, asset_type, limit, offset } = req.query || {};
    const assets = mediaService.listMedia({
      brandId: req.brand_id,
      status,
      assetType: asset_type,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({
      success: true,
      assets
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'LIST_MEDIA_ERROR'
    });
  }
});

// Get media by ID (Strictly tenant scoped)
router.get('/admin/media/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const asset = mediaService.getMedia({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'GET_MEDIA_ERROR'
    });
  }
});


// Delete media (Strictly tenant scoped, moves to ORPHAN or force hard delete)
router.delete('/admin/media/:id', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const result = await mediaService.deleteMedia({
      mediaId: req.params.id,
      brandId: req.brand_id,
      force
    });
    res.json({
      success: true,
      message: force ? 'Media berhasil dihapus permanen.' : 'Media berhasil di-unlink dan masuk masa tenggang (orphan).',
      result
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'DELETE_MEDIA_ERROR',
      references: err.references || null
    });
  }
});

// Reconcile orphan assets (M4)
router.post('/admin/media/reconcile', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const gracePeriodDays = Number(req.body && req.body.grace_period_days) || 30;
    const result = await mediaService.reconcileOrphans({
      gracePeriodDays,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Rekonsiliasi aset media selesai.',
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'RECONCILIATION_ERROR'
    });
  }
});

// Trigger Media Garbage Collection (M4)
router.post('/admin/media/gc', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const temporaryHours = Number(req.body && req.body.temporary_hours) || 24;
    const orphanGraceDays = Number(req.body && req.body.orphan_grace_days) || 30;
    const result = await mediaService.collectGarbage({
      temporaryHours,
      orphanGraceDays,
      brandId: req.brand_id
    });
    res.status(200).json({
      success: true,
      message: 'Media Garbage Collection selesai.',
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'GC_ERROR'
    });
  }
});


};
