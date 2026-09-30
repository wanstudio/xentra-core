/**
 * XENTRA CORE — PUBLIC CATALOG ROUTES
 *
 * Canonical customer-facing menu endpoint. Catalog ownership/availability comes
 * from CatalogService; media delivery is resolved through the injected batch helper.
 */
module.exports = function registerCatalogRoutes(router, deps) {
  const { db, CatalogService, MasterMenuResolver, batchResolveCustomerMediaDelivery } = deps;

router.get(['/catalog/menu', '/home'], async (req, res) => {
  try {
    const brandId = req.brand_id;
    const branchId = req.query.branch_id || '';

    // P3 BRANCH-SCOPED MENU: when a branch context is explicitly requested it must
    // belong to this brand AND be active; otherwise fail closed (400) instead of
    // silently serving a different scope (product pages never silently re-scope).
    let branchScope = null;
    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'branch not found' });
      }
      if (!branch.is_active) {
        return res.status(400).json({ success: false, error: 'branch is inactive' });
      }
      branchScope = branch;
    }

    // Forward Menu architecture:
    // - branch-scoped Customer Menu uses the structured MasterMenuResolver;
    // - brand-wide legacy/discovery mode stays on CatalogService until its
    //   consumer contract is explicitly migrated.
    const menu = branchScope && MasterMenuResolver
      ? MasterMenuResolver.resolveBranchMenu({ brandId, branchId: branchScope.id })
      : CatalogService.getMenu({ brand_id: brandId, branch_id: null });

    // Normalize the forward resolver DTO into the existing Customer catalog envelope.
    // Composition authority remains the new structured fields; these aliases exist
    // only to avoid forcing a simultaneous client rewrite.
    menu.products = (menu.products || []).map(function (p) {
      return {
        ...p,
        id: p.id || p.product_id,
        name: p.master && p.master.name ? p.master.name : p.name,
        description: p.master && p.master.description ? p.master.description : (p.description || ''),
        category_id: p.category_id || (p.categories && p.categories[0] ? p.categories[0].id : null),
        category_ids: Array.isArray(p.categories) ? p.categories.map(function (c) { return String(c.id); }) : [],
        price: p.price,
        regular_price: p.regular_price,
        is_active: p.is_active !== false,
        is_available: p.is_available !== false,
        stock_estimate: p.stock_estimate,
        menu_title: p.title,
        menu_subtitle: p.subtitle,
        menu_detail: p.detail,
        menu_indicator: p.indicator,
        menu_indicator_level: p.indicator_level || null,
        options_config: p.options || { version: 1, groups: [] }
      };
    });

    // Collect all media IDs across categories and products for batch resolution (O(1) roundtrips)
    const allMediaIds = [];
    for (const c of menu.categories) {
      if (c.media_id) allMediaIds.push(c.media_id);
    }
    for (const p of menu.products) {
      if (p.media_id) allMediaIds.push(p.media_id);
    }

    const mediaMap = batchResolveCustomerMediaDelivery({
      mediaIds: allMediaIds,
      brandId,
      assetType: 'square'
    });

    // Helper to enrich any item using the batch-resolved map with legacy fallback
    const enrichItemMedia = (item) => {
      const legacyImg = item.image_url || item.icon_url || item.image || '';
      const resolved = item.media_id ? mediaMap.get(item.media_id) : null;
      const previewUrl = resolved ? resolved.preview_url : (legacyImg || null);
      const variants = resolved ? resolved.srcset_variants : [];
      return {
        preview_url: previewUrl,
        image_url: previewUrl || legacyImg,
        image: previewUrl || legacyImg,
        media_id: resolved ? resolved.media_id : null,
        srcset_variants: variants
      };
    };

    // Enrich categories
    const categories = menu.categories.map((c) => {
      const media = enrichItemMedia(c);
      return {
        ...c,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants
      };
    });

    // Enrich products ONCE into allNormalized flat list
    const allNormalized = menu.products.map((p) => {
      const media = enrichItemMedia(p);
      return {
        ...p,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants,
        regular_price: p.regular_price || p.price,
        sale_price: p.price
      };
    });

    // Group enriched products by category_id (supports M:N categories)
    const productsByCategoryId = new Map();
    for (const p of allNormalized) {
      const catIds = (Array.isArray(p.category_ids) && p.category_ids.length > 0)
        ? p.category_ids.map(String)
        : (p.category_id != null ? [String(p.category_id)] : []);

      for (const catKey of catIds) {
        if (!productsByCategoryId.has(catKey)) {
          productsByCategoryId.set(catKey, []);
        }
        productsByCategoryId.get(catKey).push(p);
      }
    }

    // Build category tree from enriched items
    const tree = categories.map((cat) => {
      const catProducts = productsByCategoryId.get(String(cat.id)) || [];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || String(cat.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: cat.preview_url || cat.image_url || '',
        image_url: cat.preview_url || cat.image_url || '',
        media_id: cat.media_id || null,
        preview_url: cat.preview_url || null,
        srcset_variants: cat.srcset_variants || [],
        products: catProducts
      };
    });


    res.json({
      success: true,
      categories: tree,
      all_products: allNormalized,
      products: {
        items: allNormalized
      },
      promo: {
        enabled: true,
        target: 50000,
        discount: 5000,
        label: 'Selamat, kamu berhasil dapetin diskon Rp 5.000 ketika checkout!'
      }
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


};
