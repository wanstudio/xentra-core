/**
 * XENTRA CORE — PUBLIC BRAND ROUTES
 *
 * Tenant-scoped public brand discovery endpoints. Business evaluation remains
 * in PromotionEngineService and persistence remains behind the injected db facade.
 */
module.exports = function registerPublicBrandRoutes(router, deps) {
  const {
    db,
    PromotionEngineService,
    bannerMediaDelivery = () => ({ media_id: null, preview_url: null, srcset_variants: [] }),
    parseLegacyBrandBanners = () => [],
    bannerAssignmentService
  } = deps;

  function resolveBannerDelivery(banner, brandId) {
    if (!banner) return banner;
    const mediaId = banner.media_id || null;
    const legacyUrl = banner.image_url || null;

    const delivery = bannerMediaDelivery(brandId, mediaId);

    return {
      id: banner.id,
      title: banner.title || '',
      link: banner.link || '#',
      preview_url: delivery.preview_url,
      srcset_variants: delivery.srcset_variants,
      media_id: delivery.media_id,
      image_url: delivery.preview_url || legacyUrl
    };
  }

  function resolveCustomerBannerPayload(req, brandId) {
    const legacy = parseLegacyBrandBanners(req.brand);
    const requestedBranchId = req.query.branch_id || req.query.branchId || null;

    if (!requestedBranchId) {
      return legacy.map(b => resolveBannerDelivery(b, brandId));
    }

    const branch = db.prepare(`
      SELECT id, timezone
      FROM branches
      WHERE id = ?
        AND brand_id = ?
        AND is_active = 1
        AND (is_archived = 0 OR is_archived IS NULL)
      LIMIT 1
    `).get(String(requestedBranchId), brandId);

    if (!branch) {
      return legacy.map(b => resolveBannerDelivery(b, brandId));
    }

    const assignmentCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM storefront_banner_assignments
      WHERE brand_id = ? AND branch_id = ?
    `).get(brandId, branch.id);

    if (!assignmentCount || Number(assignmentCount.count || 0) === 0 || !bannerAssignmentService) {
      return legacy.map(b => resolveBannerDelivery(b, brandId));
    }

    const resolved = bannerAssignmentService.listCustomerBanners({
      brandId,
      branchId: branch.id
    });

    return resolved.map(banner => {
      const delivery = bannerMediaDelivery(brandId, banner.media_id);
      return {
        id: banner.id,
        assignment_id: banner.assignment_id,
        branch_id: banner.branch_id,
        placement: banner.placement,
        position: banner.position,
        active: banner.active,
        starts_at: banner.starts_at,
        ends_at: banner.ends_at,
        timezone: banner.timezone || branch.timezone || 'Asia/Jakarta',
        publication_status: banner.publication_status,
        effective_status: banner.effective_status,
        title: banner.title,
        alt_text: banner.alt_text,
        media_id: banner.media_id,
        preview_url: delivery.preview_url,
        srcset_variants: delivery.srcset_variants,
        cta_type: banner.cta_type,
        cta_target_id: banner.cta_target_id,
        cta_url: banner.cta_url,
        promotion_id: banner.promotion_id,
        link: banner.cta_type === 'URL' ? banner.cta_url : '#'
      };
    });
  }

  router.get('/brand/info', (req, res) => {
    try {
      const brandId = req.brand_id;

      let logoDeliveryUrl = req.brand.logo_url || null;
      if (!logoDeliveryUrl) {
        try {
          const logoMediaId = Object.prototype.hasOwnProperty.call(req.brand, 'logo_media_id')
            ? req.brand.logo_media_id
            : (db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(brandId) || {}).logo_media_id;
          if (logoMediaId) {
            const logoDelivery = bannerMediaDelivery(brandId, logoMediaId);
            if (logoDelivery.preview_url) logoDeliveryUrl = logoDelivery.preview_url;
          }
        } catch (_) {}
      }
      if (!logoDeliveryUrl) {
        logoDeliveryUrl = '/assets/pwa/icon-192.png';
      }

      const enrichedBanners = resolveCustomerBannerPayload(req, brandId);

      res.json({
        success: true,
        brand: {
          id: req.brand.id,
          name: req.brand.name,
          slug: req.brand.slug,
          logo_url: logoDeliveryUrl,
          primary_color: req.brand.primary_color || '#b6ff00',
          banners: enrichedBanners
        }
      });
    } catch (err) {
      console.error('[API Error /brand/info]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get(['/promo/active', '/promotions/active'], (req, res) => {
    try {
      const brandId = req.brand.id;
      const isPwa = req.query.is_pwa === '1' || req.query.is_pwa === 'true';
      const phone = req.query.phone || '';
      const branchId = req.query.branch_id || req.query.branchId || null;

      const evaluation = PromotionEngineService.evaluate({
        brand_id: brandId,
        branch_id: branchId,
        is_pwa_installed: isPwa,
        customer_phone: phone
      });

      res.json({
        success: true,
        promotions: evaluation.discovery,
        applied: evaluation.applied,
        rejected: evaluation.rejected
      });
    } catch (err) {
      console.error('[API Error /promo/active]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/brand/branches', (req, res) => {
    try {
      const branches = db
        .prepare(`
          SELECT
            b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
            b.is_active, b.is_open_override, b.timezone, b.reservation_max_guests,
            s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km,
            s.promo_delivery_discount, s.promo_min_order
          FROM branches b
          LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
          WHERE b.brand_id = ? AND b.is_active = 1 AND (b.is_archived = 0 OR b.is_archived IS NULL)
        `)
        .all(req.brand_id);

      res.json({
        success: true,
        branches
      });
    } catch (err) {
      console.error('[API Error /brand/branches]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
