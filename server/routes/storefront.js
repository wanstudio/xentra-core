/**
 * XENTRA CORE — STOREFRONT CATALOG SUPPORT ROUTES
 *
 * Product listing, upsell and checkout-session compatibility endpoints.
 */
module.exports = function registerStorefrontRoutes(router, deps) {
  const {
    db,
    crypto,
    batchResolveCustomerMediaDelivery
  } = deps;

// 5.1 Products List Endpoint (with Category Filtering)
router.get('/products', (req, res) => {
  try {
    const brandId = req.brand_id;
    const cat = req.query.category;
    let products = [];
    try {
      // P1 STRICT TENANT ISOLATION (NEW-01 & NEW-03):
      // Filter strictly by requested category within authoritative brand_id
      if (cat && cat !== 'all') {
        products = db.prepare(`
          SELECT DISTINCT p.* FROM products p
          WHERE p.brand_id = ?
            AND (p.category_id = ? OR ? = 'all')
            AND (p.is_active = 1 OR p.is_active IS NULL)
          ORDER BY p.sort_order ASC
        `).all(brandId, cat, cat);
      } else {
        products = db.prepare('SELECT * FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY sort_order ASC').all(brandId);
      }
    } catch (err) {
      console.warn('[Products DB Error]:', err.message);
    }

    // M6: Resolve canonical media delivery in batch (avoid N+1 queries)
    const mediaIds = (products || []).map(p => p.media_id).filter(Boolean);
    const mediaMap = batchResolveCustomerMediaDelivery({ mediaIds, brandId, assetType: 'square' });

    const normalized = (products || []).map((p) => {
      const legacyImg = p.image_url || p.image || '';
      const delivery = (p.media_id && mediaMap.get(p.media_id)) || {
        media_id: p.media_id || null,
        preview_url: legacyImg || null,
        srcset_variants: []
      };
      return {
        ...p,
        image: delivery.preview_url || legacyImg,
        image_url: delivery.preview_url || legacyImg,
        media_id: delivery.media_id,
        preview_url: delivery.preview_url,
        srcset_variants: delivery.srcset_variants,
        regular_price: p.regular_price || p.price,
        sale_price: p.price
      };
    });

    res.json({
      success: true,
      items: normalized,
      total: normalized.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Upsell Products
router.get(['/catalog/upsell', '/checkout/upsell'], (req, res) => {
  try {
    const upsells = [
      { id: 4, name: 'Es Teh Manis Jumbo', price: 6000, regular_price: 6000, image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400' },
      { id: 5, name: 'Es Jeruk Peras Asli', price: 10000, regular_price: 12000, image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400' }
    ];
    res.json({ success: true, products: upsells });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Checkout Session Sync
router.post(['/cart/sync', '/checkout/session'], (req, res) => {
  const { items = [], mode = 'all' } = req.body;
  const token = 'sess_' + crypto.randomBytes(12).toString('hex');
  res.json({
    success: true,
    token,
    session: {
      token,
      items,
      mode,
      created_at: new Date().toISOString()
    }
  });
});
};
