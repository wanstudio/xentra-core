/**
 * XENTRA CORE — PUBLIC CATALOG ROUTES
 *
 * Canonical customer-facing menu endpoint. Catalog ownership/availability comes
 * from CatalogService; media delivery is resolved through the injected batch helper.
 */
module.exports = function registerCatalogRoutes(router, deps) {
  const { db, CatalogService, batchResolveCustomerMediaDelivery } = deps;

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

    // P3: always reuse the canonical commerce CatalogService — both branch-scoped
    // and brand-wide menus go through the same domain ownership path.
    // CatalogService returns branch price override, C1 operational availability,
    // and branch stock estimate when branch_id is provided.
    const menu = CatalogService.getMenu({ brand_id: brandId, branch_id: branchScope ? branchScope.id : null });

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
