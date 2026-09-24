/**
 * XENTRA CORE — ADMIN BRAND ROUTES
 *
 * Legacy brand profile, logo and banner HTTP endpoints.
 * Canonical M5 media endpoints live in media-entities.js.
 */
'use strict';

module.exports = function registerAdminBrandRoutes(router, deps) {
  const {
    db,
    crypto,
    fs,
    path,
    ImageValidator,
    requireAuth,
    serializePublicBrand,
    coreBrandRepo,
    CoreBrandRepo
  } = deps;

  const BRAND_LOGO_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/logos');
  const BANNER_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/banners');

router.get('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.brand_id);
    if (!brand) brand = req.brand;
    res.json({
      success: true,
      brand: serializePublicBrand(brand)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, primary_color, logo_url, custom_domain, tagline, banners } = req.body;
    const bannersJson = banners ? (typeof banners === 'string' ? banners : JSON.stringify(banners)) : null;

    let normalizedPrimaryColor = undefined;
    if (primary_color !== undefined && primary_color !== null) {
      if (typeof primary_color !== 'string') {
        return res.status(400).json({ success: false, error: 'Format warna tema (hex) tidak valid.' });
      }
      let cleanHex = primary_color.trim();
      if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
      if (/^#[0-9a-fA-F]{3}$/.test(cleanHex)) {
        cleanHex = '#' + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2] + cleanHex[3] + cleanHex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return res.status(400).json({ success: false, error: 'Format warna tema (hex) tidak valid. Gunakan format #RRGGBB.' });
      }
      normalizedPrimaryColor = cleanHex.toUpperCase();
    }

    db.prepare(`
      UPDATE brands 
      SET name = COALESCE(?, name),
          primary_color = COALESCE(?, primary_color),
          logo_url = COALESCE(?, logo_url),
          custom_domain = COALESCE(?, custom_domain),
          tagline = COALESCE(?, tagline),
          banners = COALESCE(?, banners),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      normalizedPrimaryColor !== undefined ? normalizedPrimaryColor : null,
      logo_url !== undefined ? logo_url : null,
      custom_domain !== undefined ? custom_domain : null,
      tagline !== undefined ? tagline : null,
      bannersJson,
      req.brand_id
    );
    // P1.2: brand row written → drop the cached hostname→brand mapping so the
    // new profile/domain is authoritative immediately.
    CoreBrandRepo.clearCustomDomainCache();

    if (req.brand) {
      req.brand.name = name || req.brand.name;
      req.brand.primary_color = normalizedPrimaryColor || req.brand.primary_color;
      req.brand.logo_url = logo_url || req.brand.logo_url;
      req.brand.custom_domain = custom_domain || req.brand.custom_domain;
      req.brand.tagline = tagline || req.brand.tagline;
      if (bannersJson) req.brand.banners = bannersJson;
    }

    let parsedBanners = [];
    try {
      parsedBanners = bannersJson ? JSON.parse(bannersJson) : (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners);
    } catch (_) {}

    res.json({
      success: true,
      message: 'Pengaturan brand dan tema berhasil diperbarui.',
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: req.brand.primary_color || '#b6ff00',
        custom_domain: req.brand.custom_domain || 'app.mybangjo.com',
        tagline: req.brand.tagline || 'Official Online Food Ordering',
        banners: Array.isArray(parsedBanners) ? parsedBanners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { image_base64, mime_type } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Gambar logo wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'logo'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code });
    }

    fs.mkdirSync(BRAND_LOGO_DIR, { recursive: true });
    const fileName = `logo-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BRAND_LOGO_DIR, fileName), validation.buffer);

    const logoUrl = `/assets/uploads/logos/${fileName}`;
    coreBrandRepo.updateBrandLogo(req.brand_id, logoUrl);

    if (req.brand) {
      req.brand.logo_url = logoUrl;
    }

    res.json({
      success: true,
      message: 'Logo brand berhasil diunggah.',
      logo_url: logoUrl
    });
  } catch (err) {
    console.error('[API Error POST /admin/brand/logo]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    coreBrandRepo.removeBrandLogo(req.brand_id);
    if (req.brand) {
      req.brand.logo_url = null;
    }
    res.json({
      success: true,
      message: 'Logo brand berhasil dihapus.',
      logo_url: null
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/brand/logo]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11.1 Add/Upload/Delete Banners
router.post('/admin/banners/upload', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { image_base64, mime_type } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Gambar banner wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'banner'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(BANNER_IMAGE_DIR, { recursive: true });
    const fileName = `banner-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BANNER_IMAGE_DIR, fileName), validation.buffer);

    const bannerUrl = `/assets/uploads/banners/${fileName}`;
    res.json({
      success: true,
      message: 'Foto banner berhasil diunggah.',
      image_url: bannerUrl,
      info: validation.info
    });
  } catch (err) {
    console.error('[API Error POST /admin/banners/upload]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/banners', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let { image_url, image_base64, mime_type, title = '', link = '#' } = req.body || {};

    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    if (banners.length >= 5) {
      return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.' });
    }

    if (image_base64) {
      const validation = ImageValidator.validateImageUpload({
        imageBase64: image_base64,
        mimeType: mime_type,
        assetType: 'banner'
      });

      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
      }

      fs.mkdirSync(BANNER_IMAGE_DIR, { recursive: true });
      const fileName = `banner-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
      fs.writeFileSync(path.join(BANNER_IMAGE_DIR, fileName), validation.buffer);
      image_url = `/assets/uploads/banners/${fileName}`;
    }

    if (!image_url) {
      return res.status(400).json({ success: false, error: 'URL gambar banner atau file banner wajib diunggah.' });
    }

    const newBanner = {
      id: 'banner_' + Date.now(),
      image_url,
      title,
      link
    };
    banners.push(newBanner);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil ditambahkan.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/banners/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    banners = banners.filter(b => b.id !== req.params.id);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil dihapus.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

// Canonical entity media routes are isolated in server/routes/media-entities.js.
registerMediaEntityRoutes(router, { db, requireAuth, mediaService, coreBrandRepo });

// Master catalog CRUD is isolated in server/routes/admin-catalog.js.
registerAdminCatalogRoutes(router, { db, requireAuth });

// Branch CRUD/operations are isolated in server/routes/admin-branches.js.
registerAdminBranchRoutes(router, { db, crypto, requireAuth });

router.get('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const assignments = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold,
             p.name AS product_name, p.is_active AS is_master_active,
             c.name AS category_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.params.id);

    res.json({ success: true, branch_id: req.params.id, assignments: assignments || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Branch orders — enforces branch scope for branch_manager (mirrors products route)
registerAdminOrderRoutes(router, { db, requireAuth, AcceptanceTimeoutService });
registerAdminBranchCatalogRoutes(router, {
  db,
  crypto,
  requireAuth,
  CatalogService,
  PricingPolicyModel,
  XentraConnectorClient,
  InventoryStockService
});

router.get('/admin/branches/:id/inventory', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const rows = db.prepare(`
      SELECT bp.product_id, p.name AS product_name, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    res.json({ success: true, branch_id: req.params.id, inventory: rows || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/inventory]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C2 Branch inventory mutation (operational adjustment)
// body: { movement_type: 'audit_adjustment'|'waste_spoilage', quantity: <signed int>, mutation_id?, notes? }
router.patch('/admin/branches/:id/inventory/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Branch Manager may only mutate their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const movement_type = req.body && req.body.movement_type;
    const rawQuantity = req.body && req.body.quantity;
    const mutation_id = (req.body && req.body.mutation_id) ? String(req.body.mutation_id).trim() : null;
    const notes = (req.body && req.body.notes) ? String(req.body.notes) : '';

    // Only operational adjustments are exposed; purchase_in / sale_deduction stay owned by
    // their respective flows (PO receipt / order settlement).
    const MANUAL_MOVEMENT_TYPES = ['audit_adjustment', 'waste_spoilage'];
    if (!MANUAL_MOVEMENT_TYPES.includes(movement_type)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MOVEMENT_TYPE',
        message: 'Jenis mutasi manual hanya mendukung audit_adjustment atau waste_spoilage. Penerimaan PO dan pemotongan pesanan dikelola oleh alurnya masing-masing.'
      });
    }

    // C2.9 Quantity validation (finite integer; never silently coerced)
    const quantity = Number(rawQuantity);
    if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '' ||
        !Number.isFinite(Number(rawQuantity)) || !Number.isInteger(quantity) || quantity === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity harus berupa bilangan bulat bukan-nol (mis. +5 atau -3).'
      });
    }
    if (movement_type === 'waste_spoilage' && quantity > 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'waste_spoilage hanya menerima pengurangan stok (quantity negatif).'
      });
    }

    // Assignment + brand consistency must already hold (C1 trigger enforces it at the DB too).
    const assignment = db.prepare(`
      SELECT bp.branch_id
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
    }

    try {
      const movement = InventoryStockService.recordMovement({
        branch_id: req.params.id,
        product_id: req.params.productId,
        movement_type,
        quantity,
        mutation_id,
        reference_id: null,
        actor_id: req.user.userId || req.user.id || req.user.username || 'system',
        actor_role: req.user.role || 'system',
        notes
      });

      const current = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
      res.json({
        success: true,
        movement,
        stock: current ? current.stock : 0
      });
    } catch (stockErr) {
      const msg = String(stockErr && stockErr.message || '');
      if (msg.includes('Stok tidak boleh negatif')) {
        return res.status(409).json({ success: false, error: 'INSUFFICIENT_STOCK', message: stockErr.message });
      }
      if (msg.includes('tidak terdaftar di cabang')) {
        return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
      }
      console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', stockErr);
      res.status(500).json({ success: false, error: stockErr.message });
    }
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Admin Orders List & Analytics Summary
router.get('/admin/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const {
      branch_id,
      status,
      order_channel,
      fulfillment_type,
      start_date,
      end_date,
      search,
      limit,
      offset
    } = req.query;

    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ?
    `;
    const params = [req.brand_id];

    // Branch manager is strictly scoped to their assigned branch
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId) {
        query += ' AND o.branch_id = ?';
        params.push(assignedBranchId);
      }
    } else if (branch_id && branch_id !== 'all') {
      query += ' AND o.branch_id = ?';
      params.push(branch_id);
    }

    if (status && status !== 'all') {
      query += ' AND o.status = ?';
      params.push(status);
    }

    if (order_channel && order_channel !== 'all') {
      query += ' AND o.order_channel = ?';
      params.push(order_channel);
    }

    if (fulfillment_type && fulfillment_type !== 'all') {
      query += ' AND o.fulfillment_type = ?';
      params.push(fulfillment_type);
    }

    if (start_date) {
      query += ' AND o.created_at >= ?';
      params.push(start_date.includes(' ') || start_date.includes('T') ? start_date : start_date + ' 00:00:00');
    }

    if (end_date) {
      query += ' AND o.created_at <= ?';
      params.push(end_date.includes(' ') || end_date.includes('T') ? end_date : end_date + ' 23:59:59');
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query += ' AND (o.order_number LIKE ? OR o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
      params.push(q, q, q, q);
    }

    query += ' ORDER BY o.created_at DESC';

    const maxLimit = limit ? Math.min(parseInt(limit, 10), 200) : 100;
    query += ` LIMIT ${maxLimit}`;

    if (offset) {
      query += ` OFFSET ${parseInt(offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15.1 Admin Single Order Detail
router.get('/admin/orders/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.*, b.name as branch_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND o.brand_id = ?
    `).get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND',
        message: 'Pesanan tidak ditemukan pada brand ini.'
      });
    }

    // Branch manager scope guard
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== order.branch_id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat mengakses pesanan cabang yang ditugaskan.'
        });
      }
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
    const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

    // If dine-in order with dining_session_id, retrieve all session additions
    let sessionOrders = [];
    if (order.dining_session_id) {
      sessionOrders = db.prepare(`
        SELECT id, order_number, order_channel, fulfillment_type, status, grand_total, payment_status, created_at
        FROM orders
        WHERE dining_session_id = ? AND brand_id = ? AND id != ?
        ORDER BY created_at ASC
      `).all(order.dining_session_id, req.brand_id, order.id);
    }

    res.json({
      success: true,
      order: {
        ...order,
        acceptance_deadline_at: order.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order),
        items: items || [],
        delivery: delivery || null,
        payment: payment || null,
        status_logs: logs || [],
        session_orders: sessionOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Analytics/reporting routes are isolated in server/routes/admin-reporting.js.
const { PaymentRepository: CorePaymentRepo, PromotionRepository: CorePromotionRepo } = require('../../core/data/repositories');
const corePaymentRepo = new CorePaymentRepo();
const corePromotionRepo = new CorePromotionRepo();
registerPaymentConfigRoutes(router, { corePaymentRepo });

// Promotion audit helper and management routes are isolated in server/routes/admin-marketing-promotions.js.
// 1. Finance Overview API
// Finance/reporting route modules share the canonical repositories initialized above.
registerAdminReportingRoutes(router, {
  db,
  requireAuth,
  corePromotionRepo,
  corePaymentRepo
});
registerAdminFinanceRoutes(router, {
  requireAuth,
  ReportingEngine,
  overviewReportingRepo,
  corePaymentRepo
});

router.get('/admin/marketing/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    const customerOverview = overviewReportingRepo.getCustomerOverview(filter);
    const customersList = overviewReportingRepo.getCustomersList(filter);

    let newCount = 0;
    let returningCount = 0;
    let repeatPurchaseRate = 0;
    if (Array.isArray(customersList) && customersList.length > 0) {
      newCount = customersList.filter(c => c.segment === 'new').length;
      returningCount = customersList.filter(c => c.segment === 'returning').length;
      repeatPurchaseRate = Math.round((returningCount / customersList.length) * 100);
    }

    const allPromos = corePromotionRepo.findAllPromotions(req.brand_id);
    const redemptions = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      limit: 10
    });

    const activePromosCount = allPromos.filter(p => p.is_active === 1).length;
    const totalBenefitSum = allPromos.reduce((acc, p) => acc + (p.total_benefit_amount || 0), 0);
    const totalRedemptionsSum = allPromos.reduce((acc, p) => acc + (p.redemptions_count || 0), 0);

    res.json({
      success: true,
      data: {
        customer_metrics: {
          total_customers: customerOverview.total_unique_customers || 0,
          new_customers: newCount,
          returning_customers: returningCount,
          repeat_purchase_rate_pct: repeatPurchaseRate
        },
        promotion_metrics: {
          active_promotions: activePromosCount,
          total_promotions: allPromos.length,
          total_redemptions: totalRedemptionsSum,
          total_benefit_amount: totalBenefitSum
        },
        recent_redemptions: redemptions.redemptions || [],
        campaigns: { supported: false, status: 'not_configured' },
        loyalty: { supported: false, status: 'not_configured' }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Marketing Promotions List API
router.get('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const isBM = req.user.role === 'branch_manager';
    const effectiveBranchId = isBM ? (req.user.branch_id || req.user.branchId) : null;
    const promotions = corePromotionRepo.findAllPromotions(req.brand_id, effectiveBranchId);
    const enrichedPromotions = promotions.map(p => {
      const rewards = (p.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      });
      return {
        ...p,
        rewards
      };
    });
    res.json({
      success: true,
      promotions: enrichedPromotions,
      total: enrichedPromotions.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


};
