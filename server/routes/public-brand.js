/**
 * XENTRA CORE — PUBLIC BRAND ROUTES
 *
 * Tenant-scoped public brand discovery endpoints. Business evaluation remains
 * in PromotionEngineService and persistence remains behind the injected db facade.
 */
module.exports = function registerPublicBrandRoutes(router, deps) {
  const { db, PromotionEngineService } = deps;

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
