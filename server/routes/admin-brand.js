/**
 * XENTRA CORE — ADMIN BRAND ROUTES
 *
 * Brand profile/theme plus compatibility upload adapters.
 * Every client image upload is processed through the canonical Media System.
 */
'use strict';

module.exports = function registerAdminBrandRoutes(router, deps) {
  const {
    db,
    requireAuth,
    serializePublicBrand,
    coreBrandRepo,
    CoreBrandRepo,
    mediaService
  } = deps;


  async function processCanonicalImage({ brandId, tenantId, userId, imageBase64, mimeType, originalFilename, assetType, cropSpec }) {
    const staged = await mediaService.stageUpload({
      brandId,
      tenantId,
      userId,
      imageBase64,
      mimeType,
      declaredFilename: originalFilename || null,
      assetType,
      enforceAspectRatio: false
    });
    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId,
      cropSpec: cropSpec || null
    });
    return processed;
  }

  function pickPreviewUrl(asset, minWidth) {
    const variants = Array.isArray(asset && asset.variants) ? [...asset.variants].sort((a, b) => a.width - b.width) : [];
    if (!variants.length) return asset ? asset.url : null;
    const candidate = variants.find(v => v.width >= (minWidth || 320)) || variants[variants.length - 1];
    return candidate.url || asset.url;
  }

  function latestAttachedMediaId(brandId, entityType, entityId) {
    const row = db.prepare(
      "SELECT id FROM media_assets WHERE brand_id = ? AND attached_to_type = ? AND attached_to_id = ? AND status = 'ready' ORDER BY attached_at DESC LIMIT 1"
    ).get(brandId, entityType, String(entityId));
    return row ? row.id : null;
  }

  async function attachOrReplaceImage({ asset, oldMediaId, brandId, entityType, entityId }) {
    if (oldMediaId) {
      await mediaService.replaceEntityMedia({
        newMediaId: asset.media_id,
        oldMediaId,
        brandId,
        entityType,
        entityId: String(entityId)
      });
    } else {
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId,
        entityType,
        entityId: String(entityId)
      });
    }
  }

// 11. Admin Brand Profile & Theme
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
    const { name, primary_color, custom_domain, tagline, banners, merchant_pwa_name, pos_pwa_name } = req.body;
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
          merchant_pwa_icon_url = CASE WHEN ? = 1 THEN ? ELSE merchant_pwa_icon_url END,
          pos_pwa_icon_url = CASE WHEN ? = 1 THEN ? ELSE pos_pwa_icon_url END,
          merchant_pwa_name = CASE WHEN ? = 1 THEN ? ELSE merchant_pwa_name END,
          pos_pwa_name = CASE WHEN ? = 1 THEN ? ELSE pos_pwa_name END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      normalizedPrimaryColor !== undefined ? normalizedPrimaryColor : null,
      custom_domain !== undefined ? custom_domain : null,
      tagline !== undefined ? tagline : null,
      bannersJson,
      merchant_pwa_name !== undefined ? 1 : 0,
      merchant_pwa_name !== undefined ? (typeof merchant_pwa_name === 'string' ? merchant_pwa_name.trim() || null : null) : null,
      pos_pwa_name !== undefined ? 1 : 0,
      pos_pwa_name !== undefined ? (typeof pos_pwa_name === 'string' ? pos_pwa_name.trim() || null : null) : null,
      req.brand_id
    );
    // P1.2: brand row written → drop the cached hostname→brand mapping so the
    // new profile/domain is authoritative immediately.
    CoreBrandRepo.clearCustomDomainCache();

    const freshBrand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.brand_id);
    if (req.brand && freshBrand) {
      Object.assign(req.brand, freshBrand);
    }

    let parsedBanners = [];
    try {
      parsedBanners = bannersJson ? JSON.parse(bannersJson) : (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners);
    } catch (_) {}

    const targetBrand = freshBrand || req.brand;
    res.json({
      success: true,
      message: 'Pengaturan brand dan tema berhasil diperbarui.',
      brand: {
        id: targetBrand.id,
        name: targetBrand.name,
        slug: targetBrand.slug,
        logo_url: targetBrand.logo_url || '/assets/pwa/icon-192.png',
        merchant_pwa_icon_url: targetBrand.merchant_pwa_icon_url || null,
        pos_pwa_icon_url: targetBrand.pos_pwa_icon_url || null,
        merchant_pwa_name: targetBrand.merchant_pwa_name || null,
        pos_pwa_name: targetBrand.pos_pwa_name || null,
        primary_color: targetBrand.primary_color || '#b6ff00',
        custom_domain: targetBrand.custom_domain || 'app.mybangjo.com',
        tagline: targetBrand.tagline || 'Official Online Food Ordering',
        banners: Array.isArray(parsedBanners) ? parsedBanners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Canonical brand/installed-PWA media upload boundary.
router.post('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar logo wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
    const asset = await processCanonicalImage({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      originalFilename: original_filename,
      assetType: 'logo',
      cropSpec: crop_spec || null
    });

    await attachOrReplaceImage({
      asset,
      oldMediaId: brand && brand.logo_media_id,
      brandId: req.brand_id,
      entityType: 'brand_logo',
      entityId: req.brand_id
    });

    const logoUrl = pickPreviewUrl(asset, 320);
    coreBrandRepo.updateBrandLogoMedia(req.brand_id, { mediaId: asset.media_id, logoUrl });
    if (req.brand) req.brand.logo_url = logoUrl;

    res.status(201).json({
      success: true,
      message: 'Logo brand berhasil diproses, dioptimalkan, dan dikaitkan.',
      asset,
      preview_url: logoUrl,
      logo_url: logoUrl
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    console.error('[API Error POST /admin/brand/logo]:', err.message);
    res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'LOGO_UPLOAD_ERROR' });
  }
});

router.delete('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
    if (brand && brand.logo_media_id) {
      await mediaService.unlinkMedia({ mediaId: brand.logo_media_id, brandId: req.brand_id });
    }
    coreBrandRepo.removeBrandLogoMedia(req.brand_id);
    if (req.brand) req.brand.logo_url = null;
    res.json({ success: true, message: 'Logo brand berhasil dihapus.', logo_url: null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Server error', code: 'LOGO_DELETE_ERROR' });
  }
});

router.post('/admin/brand/merchant-icon', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data icon Merchant PWA wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const oldMediaId = latestAttachedMediaId(req.brand_id, 'brand_merchant_pwa_icon', req.brand_id);
    const asset = await processCanonicalImage({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      originalFilename: original_filename,
      assetType: 'logo',
      cropSpec: crop_spec || null
    });

    await attachOrReplaceImage({
      asset,
      oldMediaId,
      brandId: req.brand_id,
      entityType: 'brand_merchant_pwa_icon',
      entityId: req.brand_id
    });

    const iconUrl = pickPreviewUrl(asset, 320);
    coreBrandRepo.updateMerchantPwaIcon(req.brand_id, { iconUrl, mediaId: asset.media_id });
    if (req.brand) req.brand.merchant_pwa_icon_url = iconUrl;
    res.status(201).json({
      success: true,
      message: 'Icon Merchant PWA berhasil diproses dan diperbarui.',
      media_id: asset.media_id,
      preview_url: iconUrl,
      merchant_pwa_icon_url: iconUrl
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({ success: false, error: err.message || 'Gagal menyimpan icon Merchant PWA.', code: err.code || 'MERCHANT_PWA_ICON_UPLOAD_ERROR' });
  }
});

router.delete('/admin/brand/merchant-icon', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const oldMediaId = latestAttachedMediaId(req.brand_id, 'brand_merchant_pwa_icon', req.brand_id);
    if (oldMediaId) await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id });
    coreBrandRepo.removeMerchantPwaIcon(req.brand_id);
    if (req.brand) req.brand.merchant_pwa_icon_url = null;
    res.json({ success: true, message: 'Icon Merchant PWA berhasil dihapus.', merchant_pwa_icon_url: null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Server error', code: 'MERCHANT_PWA_ICON_DELETE_ERROR' });
  }
});

router.post('/admin/brand/pos-icon', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data icon POS PWA wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const oldMediaId = latestAttachedMediaId(req.brand_id, 'brand_pos_pwa_icon', req.brand_id);
    const asset = await processCanonicalImage({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      originalFilename: original_filename,
      assetType: 'logo',
      cropSpec: crop_spec || null
    });

    await attachOrReplaceImage({
      asset,
      oldMediaId,
      brandId: req.brand_id,
      entityType: 'brand_pos_pwa_icon',
      entityId: req.brand_id
    });

    const iconUrl = pickPreviewUrl(asset, 320);
    coreBrandRepo.updatePosPwaIcon(req.brand_id, { iconUrl, mediaId: asset.media_id });
    if (req.brand) req.brand.pos_pwa_icon_url = iconUrl;
    res.status(201).json({
      success: true,
      message: 'Icon POS PWA berhasil diproses dan diperbarui.',
      media_id: asset.media_id,
      preview_url: iconUrl,
      pos_pwa_icon_url: iconUrl
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({ success: false, error: err.message || 'Gagal menyimpan icon POS PWA.', code: err.code || 'POS_PWA_ICON_UPLOAD_ERROR' });
  }
});

router.delete('/admin/brand/pos-icon', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const oldMediaId = latestAttachedMediaId(req.brand_id, 'brand_pos_pwa_icon', req.brand_id);
    if (oldMediaId) await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id });
    coreBrandRepo.removePosPwaIcon(req.brand_id);
    if (req.brand) req.brand.pos_pwa_icon_url = null;
    res.json({ success: true, message: 'Icon POS PWA berhasil dihapus.', pos_pwa_icon_url: null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Server error', code: 'POS_PWA_ICON_DELETE_ERROR' });
  }
});

// Legacy banner adapters still use the canonical Media System. Direct filesystem writes are forbidden.
router.post('/admin/banners/upload', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar banner wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }
    const asset = await processCanonicalImage({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      originalFilename: original_filename,
      assetType: 'banner',
      cropSpec: crop_spec || null
    });
    const previewUrl = pickPreviewUrl(asset, 640);
    res.status(201).json({ success: true, message: 'Banner berhasil diproses melalui Media System.', media_id: asset.media_id, image_url: previewUrl, preview_url: previewUrl, asset });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BANNER_UPLOAD_ERROR' });
  }
});

router.post('/admin/banners', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    let { image_url, image_base64, mime_type, original_filename, title = '', link = '#', crop_spec } = req.body || {};
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch (_) {}
    if (!Array.isArray(banners)) banners = [];
    if (banners.length >= 5) {
      return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.' });
    }

    if (image_base64) {
      const asset = await processCanonicalImage({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'banner',
        cropSpec: crop_spec || null
      });
      image_url = pickPreviewUrl(asset, 640);
    } else if (image_url) {
      // Compatibility only: accept an internal Media System delivery URL, never arbitrary external URLs.
      const existing = db.prepare('SELECT id, storage_key FROM media_assets WHERE brand_id = ? AND status = \'ready\' AND (storage_key = ? OR ? LIKE \'%\' || id || \'%\') LIMIT 1')
        .get(req.brand_id, image_url, image_url);
      if (!existing) {
        return res.status(400).json({ success: false, error: 'URL gambar tidak berasal dari Media System Xentra.', code: 'EXTERNAL_MEDIA_URL_REJECTED' });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Data gambar banner wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
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
    res.status(201).json({ success: true, message: 'Banner berhasil diproses dan ditambahkan.', banners });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BANNER_UPLOAD_ERROR' });
  }
});

};
