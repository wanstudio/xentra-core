/**
 * XENTRA CORE — ADMIN BRAND ROUTES
 *
 * Brand profile/theme plus legacy logo and banner endpoints.
 * Canonical entity media lifecycle remains in media-upload.js/media-entities.js.
 */
'use strict';

module.exports = function registerAdminBrandRoutes(router, deps) {
  const {
    db,
    path,
    fs,
    crypto,
    ImageValidator,
    requireAuth,
    serializePublicBrand,
    coreBrandRepo,
    CoreBrandRepo
  } = deps;

  const BRAND_LOGO_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/logos');
  const BANNER_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/banners');

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
    const { name, primary_color, logo_url, custom_domain, tagline, banners, merchant_pwa_icon_url, pos_pwa_icon_url } = req.body;
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
          merchant_pwa_icon_url = CASE WHEN ? = 1 THEN ? ELSE merchant_pwa_icon_url END,
          pos_pwa_icon_url = CASE WHEN ? = 1 THEN ? ELSE pos_pwa_icon_url END,
          custom_domain = COALESCE(?, custom_domain),
          tagline = COALESCE(?, tagline),
          banners = COALESCE(?, banners),
          merchant_pwa_icon_url = CASE WHEN ? IS NOT NULL THEN ? ELSE merchant_pwa_icon_url END,
          pos_pwa_icon_url = CASE WHEN ? IS NOT NULL THEN ? ELSE pos_pwa_icon_url END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      normalizedPrimaryColor !== undefined ? normalizedPrimaryColor : null,
      logo_url !== undefined ? logo_url : null,
      merchant_pwa_icon_url !== undefined ? 1 : 0,
      merchant_pwa_icon_url !== undefined ? (typeof merchant_pwa_icon_url === 'string' ? merchant_pwa_icon_url.trim() : null) : null,
      pos_pwa_icon_url !== undefined ? 1 : 0,
      pos_pwa_icon_url !== undefined ? (typeof pos_pwa_icon_url === 'string' ? pos_pwa_icon_url.trim() : null) : null,
      custom_domain !== undefined ? custom_domain : null,
      tagline !== undefined ? tagline : null,
      bannersJson,
      merchant_pwa_icon_url !== undefined ? merchant_pwa_icon_url : null,
      merchant_pwa_icon_url !== undefined ? merchant_pwa_icon_url : null,
      pos_pwa_icon_url !== undefined ? pos_pwa_icon_url : null,
      pos_pwa_icon_url !== undefined ? pos_pwa_icon_url : null,
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

    res.json({
      success: true,
      message: 'Pengaturan brand dan tema berhasil diperbarui.',
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url || '/assets/pwa/icon-192.png',
        merchant_pwa_icon_url: req.brand.merchant_pwa_icon_url || null,
        pos_pwa_icon_url: req.brand.pos_pwa_icon_url || null,
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

// Brand Logo Upload & Delete Endpoints

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

// Installed PWA Identity Override — launcher icon routes
// These ONLY affect the PWA launcher icon after install.
// They do NOT change branding, RBAC, routing, or Customer PWA.

router.post('/admin/brand/merchant-icon', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    coreBrandRepo.updateMerchantPwaIcon(req.brand_id, url);
    req.brand.merchant_pwa_icon_url = url;
    return res.json({ success: true, merchant_pwa_icon_url: url });
  } catch (err) {
    console.error('[API Error POST /admin/brand/merchant-icon]:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/admin/brand/merchant-icon', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    coreBrandRepo.removeMerchantPwaIcon(req.brand_id);
    req.brand.merchant_pwa_icon_url = null;
    return res.json({ success: true, merchant_pwa_icon_url: null });
  } catch (err) {
    console.error('[API Error DELETE /admin/brand/merchant-icon]:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin/brand/pos-icon', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    coreBrandRepo.updatePosPwaIcon(req.brand_id, url);
    req.brand.pos_pwa_icon_url = url;
    return res.json({ success: true, pos_pwa_icon_url: url });
  } catch (err) {
    console.error('[API Error POST /admin/brand/pos-icon]:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/admin/brand/pos-icon', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    coreBrandRepo.removePosPwaIcon(req.brand_id);
    req.brand.pos_pwa_icon_url = null;
    return res.json({ success: true, pos_pwa_icon_url: null });
  } catch (err) {
    console.error('[API Error DELETE /admin/brand/pos-icon]:', err);
    return res.status(500).json({ error: 'Server error' });
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

};
